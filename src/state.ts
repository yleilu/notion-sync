import { createHash } from 'crypto';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
} from 'fs/promises';
import { resolve } from 'path';
import { homedir } from 'os';

export interface FileState {
  notionPageId: string
  localHash: string
  localMtime: number
  localSize: number
  notionLastEdited: string
  lastSyncedAt: string
}

export interface DirState {
  notionPageId: string
}

export interface SyncState {
  statePageId: string
  rootPageId: string
  dirPath: string
  files: Record<string, FileState>
  dirs: Record<string, DirState>
}

const BASE_DIR = resolve(homedir(), '.notion-sync');

export const hashPath = (dirPath: string, pageId: string): string => createHash('sha256')
  .update(`${pageId}:${resolve(dirPath)}`)
  .digest('hex')
  .slice(0, 7);

export const hashContent = (content: string): string => createHash('sha256').update(content).digest('hex');

export const getStateDir = (dirPath: string, pageId: string): string => (
  resolve(BASE_DIR, hashPath(dirPath, pageId))
);

export const loadState = async (
  dirPath: string,
  pageId: string,
): Promise<SyncState | null> => {
  const stateFile = resolve(
    getStateDir(dirPath, pageId),
    'state.json',
  );
  try {
    const raw = await readFile(stateFile, 'utf-8');

    return JSON.parse(raw) as SyncState;
  } catch {
    return null;
  }
};

export const saveState = async (
  dirPath: string,
  state: SyncState,
): Promise<void> => {
  const dir = getStateDir(dirPath, state.statePageId);
  await mkdir(dir, {
    recursive: true,
  });
  const stateFile = resolve(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify(state, null, 2));
};

export const writePid = async (
  dirPath: string,
  pageId: string,
): Promise<void> => {
  const dir = getStateDir(dirPath, pageId);
  await mkdir(dir, {
    recursive: true,
  });
  const pidFile = resolve(dir, 'daemon.pid');
  await writeFile(pidFile, String(process.pid));
};

export const readPid = async (
  dirPath: string,
  pageId: string,
): Promise<number | null> => {
  const pidFile = resolve(
    getStateDir(dirPath, pageId),
    'daemon.pid',
  );
  try {
    const raw = await readFile(pidFile, 'utf-8');

    return parseInt(raw.trim(), 10);
  } catch {
    return null;
  }
};

export const cleanPid = async (
  dirPath: string,
  pageId: string,
): Promise<void> => {
  const pidFile = resolve(
    getStateDir(dirPath, pageId),
    'daemon.pid',
  );
  try {
    await unlink(pidFile);
  } catch {
    // ignore if already removed
  }
};

export const readPidById = async (
  id: string,
): Promise<number | null> => {
  const pidFile = resolve(BASE_DIR, id, 'daemon.pid');
  try {
    const raw = await readFile(pidFile, 'utf-8');
    return parseInt(raw.trim(), 10);
  } catch {
    return null;
  }
};

export const cleanPidById = async (
  id: string,
): Promise<void> => {
  const pidFile = resolve(BASE_DIR, id, 'daemon.pid');
  try {
    await unlink(pidFile);
  } catch {
    // ignore if already removed
  }
};

export interface DaemonInfo {
  id: string
  pid: number
  dirPath: string
  rootPageId: string
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const listDaemons = async (): Promise<
  DaemonInfo[]
> => {
  let entries: string[];
  try {
    entries = await readdir(BASE_DIR);
  } catch {
    return [];
  }

  const daemons: DaemonInfo[] = [];

  for (const id of entries) {
    const dir = resolve(BASE_DIR, id);
    const pid = await readPidById(id);
    if (pid === null) continue;

    if (!isAlive(pid)) {
      await cleanPidById(id);
      continue;
    }

    try {
      const raw = await readFile(
        resolve(dir, 'state.json'),
        'utf-8',
      );
      const state = JSON.parse(raw) as SyncState;
      daemons.push({
        id,
        pid,
        dirPath: state.dirPath,
        rootPageId: state.rootPageId,
      });
    } catch {
      // state.json missing or unreadable, skip
    }
  }

  return daemons;
};

export const findDaemonDir = async (
  id: string,
): Promise<string | null> => {
  let entries: string[];
  try {
    entries = await readdir(BASE_DIR);
  } catch {
    return null;
  }
  const match = entries.find((e) => e.startsWith(id));
  return match ? resolve(BASE_DIR, match) : null;
};
