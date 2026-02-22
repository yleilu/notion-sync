import {
  readdir,
  readFile,
  writeFile,
  mkdir,
} from 'fs/promises';
import {
  resolve,
  relative,
  basename,
  dirname,
  extname,
} from 'path';

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

import type { SyncState } from './state.js';

interface LocalFile {
  relativePath: string
  absolutePath: string
}

interface LocalDir {
  relativePath: string
  absolutePath: string
}

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
    for (const entry of entries) {
      const abs = resolve(current, entry.name);
      const rel = relative(dirPath, abs);

      if (
        entry.isDirectory()
        || (entry.isSymbolicLink()
          && entry.name !== 'node_modules')
      ) {
        if (entry.isDirectory()) {
          dirs.push({
            relativePath: rel,
            absolutePath: abs,
          });
          await walk(abs);
        }
      } else if (
        entry.isFile()
        && extname(entry.name) === '.md'
      ) {
        files.push({
          relativePath: rel,
          absolutePath: abs,
        });
      }
    }
  };

  await walk(dirPath);

  return {
    files,
    dirs,
  };
};

interface NotionTree {
  [title: string]: {
    id: string
    children: NotionTree
  }
}

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
  const pageId = await createPage(parentPageId, title, []);
  state.dirs[dirRelPath] = {
    notionPageId: pageId,
  };
  console.log(
    'Created dir page: %s → %s',
    dirRelPath,
    pageId,
  );

  return pageId;
};

const syncSingleFile = async (
  file: LocalFile,
  rootPageId: string,
  state: SyncState,
): Promise<void> => {
  const content = await readFile(file.absolutePath, 'utf-8');
  const hash = hashContent(content);
  const existing = state.files[file.relativePath];

  if (existing && existing.localHash === hash) {
    console.log('Unchanged: %s', file.relativePath);

    return;
  }

  const title = titleFromPath(file.relativePath);
  const blocks = mdToBlocks(content);
  const parentDir = dirname(file.relativePath);
  let parentPageId = rootPageId;

  if (parentDir !== '.') {
    parentPageId = await ensureDirPage(
      parentDir,
      rootPageId,
      state,
    );
  }

  if (existing) {
    console.log('Updating: %s', file.relativePath);
    await updatePageContent(existing.notionPageId, blocks);
    const { lastEditedTime } = await getPageMeta(
      existing.notionPageId,
    );
    state.files[file.relativePath] = {
      notionPageId: existing.notionPageId,
      localHash: hash,
      notionLastEdited: lastEditedTime,
      lastSyncedAt: new Date().toISOString(),
    };
  } else {
    console.log('Creating: %s', file.relativePath);
    const pageId = await createPage(
      parentPageId,
      title,
      blocks,
    );
    const { lastEditedTime } = await getPageMeta(pageId);
    state.files[file.relativePath] = {
      notionPageId: pageId,
      localHash: hash,
      notionLastEdited: lastEditedTime,
      lastSyncedAt: new Date().toISOString(),
    };
  }
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
  for (const dir of dirs) {
    await ensureDirPage(dir.relativePath, rootPageId, state);
  }

  // Sync each file (sequential — API rate limits)
  for (const file of files) {
    await syncSingleFile(file, rootPageId, state);
  }

  // Archive removed files
  const localPaths = new Set(files.map((f) => f.relativePath));
  const removedEntries = Object.entries(state.files).filter(
    ([relPath]) => !localPaths.has(relPath),
  );
  for (const [relPath, fileState] of removedEntries) {
    console.log('Archiving: %s', relPath);
    await archivePage(fileState.notionPageId);
    delete state.files[relPath];
  }

  await saveState(absDir, state);

  return state;
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
  const hash = hashContent(content);
  const existing = state.files[relPath];

  if (existing && existing.localHash === hash) {
    return;
  }

  const title = titleFromPath(relPath);
  const blocks = mdToBlocks(content);
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
    await updatePageContent(existing.notionPageId, blocks);
    const { lastEditedTime } = await getPageMeta(
      existing.notionPageId,
    );
    state.files[relPath] = {
      notionPageId: existing.notionPageId,
      localHash: hash,
      notionLastEdited: lastEditedTime,
      lastSyncedAt: new Date().toISOString(),
    };
  } else {
    console.log('Creating: %s', relPath);
    const pageId = await createPage(
      parentPageId,
      title,
      blocks,
    );
    const { lastEditedTime } = await getPageMeta(pageId);
    state.files[relPath] = {
      notionPageId: pageId,
      localHash: hash,
      notionLastEdited: lastEditedTime,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  await saveState(absDir, state);
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
  const absDir = resolve(dirPath);

  // Sequential — API rate limits
  for (const [relPath, fileState] of Object.entries(
    state.files,
  )) {
    try {
      const { lastEditedTime } = await getPageMeta(
        fileState.notionPageId,
      );

      if (lastEditedTime !== fileState.notionLastEdited) {
        console.log('Notion changed: %s', relPath);
        const md = await blocksToMd(fileState.notionPageId);
        const absFile = resolve(absDir, relPath);
        await mkdir(dirname(absFile), {
          recursive: true,
        });
        await writeFile(absFile, md);

        state.files[relPath] = {
          ...fileState,
          localHash: hashContent(md),
          notionLastEdited: lastEditedTime,
          lastSyncedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error('Error checking %s:', relPath, err);
    }
  }

  await saveState(absDir, state);
};
