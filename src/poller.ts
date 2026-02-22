import { syncFromNotion } from './sync.js';

import type { SyncState } from './state.js';

const POLL_INTERVAL_MS = 3e4;

export const startPoller = (
  dirPath: string,
  state: SyncState,
): ReturnType<typeof setInterval> => {
  console.log(
    'Polling Notion every %ds',
    POLL_INTERVAL_MS / 1e3,
  );

  return setInterval(() => {
    syncFromNotion(dirPath, state)
      .then(() => console.log(
        '[%s] Poll complete',
        new Date().toISOString(),
      ))
      .catch((err) => console.error(
        '[%s] Poll error:',
        new Date().toISOString(),
        err,
      ));
  }, POLL_INTERVAL_MS);
};
