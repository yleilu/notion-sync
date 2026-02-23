import { resolve, relative, extname } from 'path';

import { watch } from 'chokidar';

import { syncFile, syncDeleteFile } from './sync.js';
import { syncLock } from './sync-lock.js';

import type { SyncState } from './state.js';
import type { FSWatcher } from 'chokidar';

const DEBOUNCE_MS = 1e3;
const timers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
const syncing = new Set<string>();
type PendingFn = () => Promise<void>
const pending = new Map<string, PendingFn>();

const debounce = (key: string, fn: () => void): void => {
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, DEBOUNCE_MS),
  );
};

const guardedSync = async (
  key: string,
  fn: () => Promise<void>,
): Promise<void> => {
  if (syncing.has(key)) {
    pending.set(key, fn);
    return;
  }
  syncing.add(key);
  try {
    await fn();
  } finally {
    syncing.delete(key);
    const next = pending.get(key);
    if (next) {
      pending.delete(key);
      debounce(key, () => {
        guardedSync(key, next).catch((err) => console.error(
          'Sync error (resync %s):',
          key,
          err,
        ));
      });
    }
  }
};

export const startWatcher = (
  dirPath: string,
  state: SyncState,
): FSWatcher => {
  const absDir = resolve(dirPath);

  const watcher = watch(absDir, {
    ignoreInitial: true,
    followSymlinks: true,
  });

  const handle = (event: string, absPath: string): void => {
    if (extname(absPath) !== '.md') {
      return;
    }

    const relPath = relative(absDir, absPath);

    // Ignore file changes caused by the poller writing files
    if (syncLock.isPollerWriting(relPath)) {
      return;
    }

    const logSyncErr = (
      label: string,
      err: unknown,
    ): void => {
      console.error('Sync error (%s):', label, err);
    };

    if (event === 'add' || event === 'change') {
      debounce(relPath, () => {
        guardedSync(relPath, () => syncLock.runWatcher(() => syncFile(absPath, absDir, state))).catch((err) => logSyncErr(`${event} ${relPath}`, err));
      });
    } else if (event === 'unlink') {
      debounce(relPath, () => {
        guardedSync(relPath, () => syncLock.runWatcher(() => syncDeleteFile(absPath, absDir, state))).catch((err) => logSyncErr(`unlink ${relPath}`, err));
      });
    }
  };

  watcher.on('all', handle);

  console.log('Watching: %s', absDir);

  return watcher;
};
