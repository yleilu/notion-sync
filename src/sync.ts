import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  stat,
} from 'fs/promises';
import {
  resolve,
  relative,
  basename,
  dirname,
  extname,
} from 'path';
import { appendFileSync } from 'fs';
import { homedir } from 'os';

import {
  hashContent,
  loadState,
  saveState,
} from './state.js';
import {
  getChildPages,
  createPage,
  updatePageContent,
  archivePage,
  getPageMeta,
} from './notion.js';
import { mdToBlocks, blocksToMd } from './converter.js';
import { syncLock } from './sync-lock.js';

import type { SyncState, FileState } from './state.js';

const DEBUG_LOG = resolve(
  homedir(),
  '.notion-sync',
  'debug.jsonl',
);

const debugLog = (entry: Record<string, unknown>): void => {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  });
  try {
    appendFileSync(DEBUG_LOG, `${line}\n`);
  } catch {
    /* ignore */
  }
};

type NotionTree = Record<
  string,
  {
    id: string
    children: NotionTree
  }
>

interface LocalFile {
  relativePath: string
  absolutePath: string
}

interface LocalDir {
  relativePath: string
  absolutePath: string
}

const buildFileState = (
  notionPageId: string,
  localHash: string,
  notionLastEdited: string,
): FileState => ({
  notionPageId,
  localHash,
  notionLastEdited,
  lastSyncedAt: new Date().toISOString(),
});

export const scanLocal = async (
  dirPath: string,
): Promise<{
  files: LocalFile[]
  dirs: LocalDir[]
}> => {
  const files: LocalFile[] = [];
  const dirs: LocalDir[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, {
      withFileTypes: true,
    });

    // Sequential walk — must await each dir
    await entries.reduce(
      (chain, entry) => chain.then(async () => {
        if (entry.name === 'node_modules') return;

        const abs = resolve(current, entry.name);
        const rel = relative(dirPath, abs);

        // Follow symlinks — stat resolves to the target
        let resolved;
        if (entry.isSymbolicLink()) {
          try {
            resolved = await stat(abs);
          } catch {
            console.log(
              'Skipping broken symlink: %s',
              rel,
            );
            return;
          }
        } else {
          resolved = entry;
        }

        if (resolved.isDirectory()) {
          dirs.push({
            relativePath: rel,
            absolutePath: abs,
          });
          await walk(abs);
        } else if (
          resolved.isFile()
            && extname(entry.name) === '.md'
        ) {
          files.push({
            relativePath: rel,
            absolutePath: abs,
          });
        }
      }),
      Promise.resolve(),
    );
  };

  await walk(dirPath);

  return {
    files,
    dirs,
  };
};

export const fetchNotionTree = async (
  pageId: string,
): Promise<NotionTree> => {
  const children = await getChildPages(pageId);
  const entries = await Promise.all(
    children.map(async ({ id, title }) => {
      const subtree = await fetchNotionTree(id);

      return [
        title,
        {
          id,
          children: subtree,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
};

// prettier-ignore
const titleFromPath = (
  relativePath: string,
): string => basename(relativePath, extname(relativePath));

const ensureDirPage = async (
  dirRelPath: string,
  rootPageId: string,
  state: SyncState,
): Promise<string> => {
  if (state.dirs[dirRelPath]) {
    return state.dirs[dirRelPath].notionPageId;
  }

  const parent = dirname(dirRelPath);
  let parentPageId = rootPageId;

  if (parent !== '.') {
    parentPageId = await ensureDirPage(
      parent,
      rootPageId,
      state,
    );
  }

  const title = basename(dirRelPath);

  // Check Notion for an existing child page with the same title
  // to avoid duplicates when state is lost or reset
  const siblings = await getChildPages(parentPageId);
  const existing = siblings.find((c) => c.title === title);

  let pageId: string;
  if (existing) {
    pageId = existing.id;
    console.log(
      'Reusing dir page: %s → %s',
      dirRelPath,
      pageId,
    );
  } else {
    pageId = await createPage(parentPageId, title, []);
    console.log(
      'Created dir page: %s → %s',
      dirRelPath,
      pageId,
    );
  }

  state.dirs[dirRelPath] = {
    notionPageId: pageId,
  };

  return pageId;
};

export const syncFile = async (
  filePath: string,
  dirPath: string,
  state: SyncState,
): Promise<void> => {
  const absDir = resolve(dirPath);
  const absFile = resolve(filePath);
  const relPath = relative(absDir, absFile);
  const content = await readFile(absFile, 'utf-8');

  debugLog({
    event: 'syncFile:enter',
    relPath,
    contentLength: content.length,
    contentPreview: content.slice(0, 200),
    contentEmpty: content.trim() === '',
  });

  if (content.trim() === '') {
    console.log('Skipping empty file: %s', relPath);

    return;
  }

  const hash = hashContent(content);
  const existing = state.files[relPath];

  if (existing && existing.localHash === hash) {
    console.log('Unchanged: %s', relPath);

    return;
  }

  const title = titleFromPath(relPath);
  const blocks = mdToBlocks(content);

  debugLog({
    event: 'syncFile:willSync',
    relPath,
    hasExisting: !!existing,
    oldHash: existing
      ? existing.localHash.slice(0, 8)
      : null,
    newHash: hash.slice(0, 8),
    blockCount: blocks.length,
  });
  const parentDir = dirname(relPath);
  let parentPageId = state.rootPageId;

  if (parentDir !== '.') {
    parentPageId = await ensureDirPage(
      parentDir,
      state.rootPageId,
      state,
    );
  }

  if (existing) {
    console.log('Updating: %s', relPath);
    await updatePageContent(
      existing.notionPageId,
      blocks,
      `syncFile:update:${relPath}`,
    );
    const { lastEditedTime } = await getPageMeta(
      existing.notionPageId,
    );
    state.files[relPath] = buildFileState(
      existing.notionPageId,
      hash,
      lastEditedTime,
    );
  } else {
    // Check Notion for an existing child page with the same title
    const siblings = await getChildPages(parentPageId);
    const match = siblings.find((c) => c.title === title);

    let pageId: string;
    if (match) {
      console.log('Reusing: %s → %s', relPath, match.id);
      pageId = match.id;
      await updatePageContent(
        pageId,
        blocks,
        `syncFile:reuse:${relPath}`,
      );
    } else {
      console.log('Creating: %s', relPath);
      pageId = await createPage(parentPageId, title, blocks);
    }

    const { lastEditedTime } = await getPageMeta(pageId);
    state.files[relPath] = buildFileState(
      pageId,
      hash,
      lastEditedTime,
    );
  }

  await saveState(absDir, state);
};

const pullNotionOnly = async (
  tree: NotionTree,
  parentRelPath: string,
  absDir: string,
  state: SyncState,
): Promise<void> => {
  await Object.entries(tree).reduce(
    (chain, [title, node]) => chain.then(async () => {
      const hasChildren = Object.keys(node.children).length > 0;

      if (hasChildren) {
        const dirRelPath = parentRelPath
          ? `${parentRelPath}/${title}`
          : title;

        if (!state.dirs[dirRelPath]) {
          const localDir = resolve(absDir, dirRelPath);
          await mkdir(localDir, {
            recursive: true,
          });
          state.dirs[dirRelPath] = {
            notionPageId: node.id,
          };
          console.log('Pulled dir: %s', dirRelPath);
        }

        await pullNotionOnly(
          node.children,
          dirRelPath,
          absDir,
          state,
        );
      } else {
        const fileRelPath = parentRelPath
          ? `${parentRelPath}/${title}.md`
          : `${title}.md`;

        if (!state.files[fileRelPath]) {
          const md = await blocksToMd(node.id);

          if (!md || md.trim() === '') {
            console.log(
              'Skipping empty Notion page: %s',
              fileRelPath,
            );

            return;
          }

          const absFile = resolve(absDir, fileRelPath);
          await mkdir(dirname(absFile), {
            recursive: true,
          });
          syncLock.markPollerWrite(fileRelPath);
          await writeFile(absFile, md);
          syncLock.clearPollerWrite(fileRelPath);

          const { lastEditedTime } = await getPageMeta(
            node.id,
          );
          state.files[fileRelPath] = buildFileState(
            node.id,
            hashContent(md),
            lastEditedTime,
          );
          console.log('Pulled file: %s', fileRelPath);
        }
      }
    }),
    Promise.resolve(),
  );
};

export const startupSync = async (
  dirPath: string,
  rootPageId: string,
): Promise<SyncState> => {
  const absDir = resolve(dirPath);
  let state = await loadState(absDir);

  if (!state) {
    state = {
      rootPageId,
      dirPath: absDir,
      files: {},
      dirs: {},
    };
  }

  state.rootPageId = rootPageId;
  const { files, dirs } = await scanLocal(absDir);

  // Ensure dir pages exist (sequential — API rate limits)
  await dirs.reduce(
    (chain, dir) => chain.then(async () => {
      await ensureDirPage(
        dir.relativePath,
        rootPageId,
        state,
      );
    }),
    Promise.resolve(),
  );

  // Sync each file (sequential — API rate limits)
  await files.reduce(
    (chain, file) => chain.then(() => syncFile(file.absolutePath, absDir, state)),
    Promise.resolve(),
  );

  // Capture pre-pull keys so archive doesn't touch newly pulled files
  const prePullFileKeys = new Set(Object.keys(state.files));

  // Discover Notion-only pages and pull them locally
  const notionTree = await fetchNotionTree(rootPageId);
  await pullNotionOnly(notionTree, '', absDir, state);

  // Archive: only files that were already tracked AND deleted locally
  const localPaths = new Set(files.map((f) => f.relativePath));
  const removedEntries = Object.entries(state.files).filter(
    ([relPath]) => prePullFileKeys.has(relPath)
      && !localPaths.has(relPath),
  );
  await removedEntries.reduce(
    (chain, [relPath, fileState]) => chain.then(async () => {
      console.log('Archiving: %s', relPath);
      await archivePage(fileState.notionPageId);
      delete state.files[relPath];
    }),
    Promise.resolve(),
  );

  await saveState(absDir, state);

  return state;
};

export const syncDeleteFile = async (
  filePath: string,
  dirPath: string,
  state: SyncState,
): Promise<void> => {
  const absDir = resolve(dirPath);
  const relPath = relative(absDir, resolve(filePath));
  const existing = state.files[relPath];

  if (!existing) {
    return;
  }

  console.log('Archiving: %s', relPath);
  await archivePage(existing.notionPageId);
  delete state.files[relPath];
  await saveState(absDir, state);
};

export const syncFromNotion = async (
  dirPath: string,
  state: SyncState,
): Promise<void> => {
  // Skip polling while the watcher is actively syncing to Notion.
  // Polling during a watcher sync can read partial Notion state and
  // overwrite the local file with truncated content.
  if (syncLock.isWatcherActive()) {
    debugLog({
      event: 'syncFromNotion:skipped',
      reason: 'watcherActive',
    });
    console.log('Skipping poll — watcher sync in progress');
    return;
  }

  const absDir = resolve(dirPath);

  // Sequential — API rate limits
  await Object.entries(state.files).reduce(
    (chain, [relPath, fileState]) => chain.then(async () => {
      try {
        const { lastEditedTime } = await getPageMeta(
          fileState.notionPageId,
        );

        if (
          lastEditedTime !== fileState.notionLastEdited
        ) {
          debugLog({
            event: 'syncFromNotion:changed',
            relPath,
            oldEditedTime: fileState.notionLastEdited,
            newEditedTime: lastEditedTime,
          });
          console.log('Notion changed: %s', relPath);
          const md = await blocksToMd(
            fileState.notionPageId,
          );
          const absFile = resolve(absDir, relPath);
          await mkdir(dirname(absFile), {
            recursive: true,
          });

          // Mark this file so the watcher ignores the write
          syncLock.markPollerWrite(relPath);
          await writeFile(absFile, md);
          syncLock.clearPollerWrite(relPath);

          state.files[relPath] = buildFileState(
            fileState.notionPageId,
            hashContent(md),
            lastEditedTime,
          );
        }
      } catch (err) {
        console.error('Error checking %s:', relPath, err);
      }
    }),
    Promise.resolve(),
  );

  await saveState(absDir, state);
};
