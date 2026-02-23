// Coordination lock between the watcher (local→Notion) and the webhook (Notion→local).
//
// Problem: When the watcher syncs a file to Notion, the webhook triggers a
// sync that pulls the page and writes the file — triggering the
// watcher again in an infinite loop. Worse, the webhook handler may read Notion while the
// watcher's API calls are still in flight, getting partial content.
//
// Solution: A simple mutual exclusion that prevents the webhook handler from running while
// the watcher is syncing, and marks webhook-written files so the watcher ignores them.

const pollerWriting = new Set<string>();
let watcherActive = 0;

const markPollerWrite = (relPath: string): void => {
  pollerWriting.add(relPath);
};

const clearPollerWrite = (relPath: string): void => {
  // Delay clearing so the watcher's debounce window passes
  setTimeout(() => {
    pollerWriting.delete(relPath);
  }, 2e3);
};

const isPollerWriting = (relPath: string): boolean => pollerWriting.has(relPath);

const isWatcherActive = (): boolean => watcherActive > 0;

const runWatcher = async <T>(
  fn: () => Promise<T>,
): Promise<T> => {
  watcherActive += 1;
  try {
    return await fn();
  } finally {
    watcherActive -= 1;
  }
};

export const syncLock = {
  markPollerWrite,
  clearPollerWrite,
  isPollerWriting,
  isWatcherActive,
  runWatcher,
};
