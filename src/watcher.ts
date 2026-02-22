import { resolve, relative, extname } from 'path';

import { watch } from 'chokidar';

import { syncFile, syncDeleteFile } from './sync.js';

import type { SyncState } from './state.js';
import type { FSWatcher } from 'chokidar';

const DEBOUNCE_MS = 1e3;
const timers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

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

export const startWatcher = (
  dirPath: string,
  state: SyncState,
): FSWatcher => {
  const absDir = resolve(dirPath);

  // Watch directory directly — glob patterns don't follow symlinks in chokidar v4
  const watcher = watch(absDir, {
    ignoreInitial: true,
    followSymlinks: true,
  });

  const handle = (event: string, absPath: string): void => {
    if (extname(absPath) !== '.md') {
      return;
    }

    const relPath = relative(absDir, absPath);

    if (event === 'add' || event === 'change') {
      debounce(relPath, () => {
        syncFile(absPath, absDir, state).catch((err) => console.error(
          'Sync error (%s %s):',
          event,
          relPath,
          err,
        ));
      });
    } else if (event === 'unlink') {
      debounce(relPath, () => {
        syncDeleteFile(absPath, absDir, state).catch((err) => console.error(
          'Sync error (unlink %s):',
          relPath,
          err,
        ));
      });
    }
  };

  watcher.on('all', handle);

  console.log('Watching: %s', absDir);

  return watcher;
};
