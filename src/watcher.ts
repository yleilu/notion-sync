import { resolve } from 'path';

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

  const watcher = watch('**/*.md', {
    cwd: absDir,
    ignoreInitial: true,
    followSymlinks: true,
  });

  watcher.on('add', (relPath) => {
    const absPath = resolve(absDir, relPath);
    debounce(relPath, () => {
      syncFile(absPath, absDir, state).catch((err) => console.error('Sync error (add %s):', relPath, err));
    });
  });

  watcher.on('change', (relPath) => {
    const absPath = resolve(absDir, relPath);
    debounce(relPath, () => {
      syncFile(absPath, absDir, state).catch((err) => console.error(
        'Sync error (change %s):',
        relPath,
        err,
      ));
    });
  });

  watcher.on('unlink', (relPath) => {
    const absPath = resolve(absDir, relPath);
    debounce(relPath, () => {
      syncDeleteFile(absPath, absDir, state).catch((err) => console.error(
        'Sync error (unlink %s):',
        relPath,
        err,
      ));
    });
  });

  console.log('Watching: %s', absDir);

  return watcher;
};
