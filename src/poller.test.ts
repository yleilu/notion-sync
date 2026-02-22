import { jest } from '@jest/globals';

jest.useFakeTimers();

jest.unstable_mockModule('./sync.js', () => ({
  syncFromNotion: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

let startPoller: typeof import('./poller.js')['startPoller'];
let syncFromNotion: jest.Mock;

const state = {
  rootPageId: 'root-page-id',
  dirPath: '/test/dir',
  files: {},
  dirs: {},
};

beforeAll(async () => {
  const pollerMod = await import('./poller.js');
  const syncMod = await import('./sync.js');

  startPoller = pollerMod.startPoller;
  syncFromNotion = syncMod.syncFromNotion as unknown as jest.Mock;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('returns interval handle', () => {
  const handle = startPoller('/test/dir', state);

  expect(handle).toBeDefined();

  clearInterval(handle);
});

test('calls syncFromNotion every 30s', async () => {
  const handle = startPoller('/test/dir', state);

  expect(syncFromNotion).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(30_000);
  expect(syncFromNotion).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(30_000);
  expect(syncFromNotion).toHaveBeenCalledTimes(2);

  clearInterval(handle);
});

test('errors caught — no unhandled rejection', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  (syncFromNotion as jest.Mock<() => Promise<void>>).mockRejectedValueOnce(new Error('Notion API down'));

  const handle = startPoller('/test/dir', state);

  await jest.advanceTimersByTimeAsync(30_000);

  expect(consoleError).toHaveBeenCalledWith(
    'Poll error:',
    expect.any(Error),
  );

  consoleError.mockRestore();
  clearInterval(handle);
});
