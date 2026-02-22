import { createHash } from 'crypto';
import {
  mkdir,
  readFile,
  writeFile,
  unlink,
} from 'fs/promises';
import { resolve } from 'path';
import { homedir } from 'os';

export interface FileState {
  notionPageId: string
  localHash: string
  notionLastEdited: string
  lastSyncedAt: string
}

export interface DirState {
  notionPageId: string
}

export interface SyncState {
  rootPageId: string
  dirPath: string
  files: Record<string, FileState>
  dirs: Record<string, DirState>
}

const BASE_DIR = resolve(homedir(), '.notion-sync');

const hashPath = (dirPath: string): string => createHash('sha256')
  .update(resolve(dirPath))
  .digest('hex')
  .slice(0, 12);

export const hashContent = (content: string): string => createHash('sha256').update(content).digest('hex');

export const getStateDir = (dirPath: string): string => resolve(BASE_DIR, hashPath(dirPath));

export const loadState = async (
  dirPath: string,
): Promise<SyncState | null> => {
  const stateFile = resolve(
    getStateDir(dirPath),
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
  const dir = getStateDir(dirPath);
  await mkdir(dir, {
    recursive: true,
  });
  const stateFile = resolve(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify(state, null, 2));
};

export const writePid = async (
  dirPath: string,
): Promise<void> => {
  const dir = getStateDir(dirPath);
  await mkdir(dir, {
    recursive: true,
  });
  const pidFile = resolve(dir, 'daemon.pid');
  await writeFile(pidFile, String(process.pid));
};

export const readPid = async (
  dirPath: string,
): Promise<number | null> => {
  const pidFile = resolve(
    getStateDir(dirPath),
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
): Promise<void> => {
  const pidFile = resolve(
    getStateDir(dirPath),
    'daemon.pid',
  );
  try {
    await unlink(pidFile);
  } catch {
    // ignore if already removed
  }
};
