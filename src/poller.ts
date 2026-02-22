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
    syncFromNotion(dirPath, state).catch((err) => console.error('Poll error:', err));
  }, POLL_INTERVAL_MS);
};
