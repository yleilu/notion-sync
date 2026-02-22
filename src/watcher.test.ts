import { jest } from '@jest/globals';

jest.useFakeTimers();

const handlers: Record<string, (path: string) => void> = {};
const fakeWatcher = {
  on: jest.fn((event: string, handler: (path: string) => void): typeof fakeWatcher => {
    handlers[event] = handler;
    return fakeWatcher;
  }),
};

jest.unstable_mockModule('chokidar', () => ({
  watch: jest.fn(() => fakeWatcher),
}));

jest.unstable_mockModule('./sync.js', () => ({
  syncFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  syncDeleteFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

let startWatcher: typeof import('./watcher.js')['startWatcher'];
let watch: jest.Mock;
let syncFile: jest.Mock;
let syncDeleteFile: jest.Mock;

const state = {
  rootPageId: 'root-page-id',
  dirPath: '/test/dir',
  files: {},
  dirs: {},
};

beforeAll(async () => {
  const watcherMod = await import('./watcher.js');
  const chokidarMod = await import('chokidar');
  const syncMod = await import('./sync.js');

  startWatcher = watcherMod.startWatcher;
  watch = chokidarMod.watch as unknown as jest.Mock;
  syncFile = syncMod.syncFile as unknown as jest.Mock;
  syncDeleteFile = syncMod.syncDeleteFile as unknown as jest.Mock;
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
});

test('creates watcher with correct options', () => {
  startWatcher('/test/dir', state);

  expect(watch).toHaveBeenCalledWith('**/*.md', {
    cwd: expect.any(String),
    ignoreInitial: true,
    followSymlinks: true,
  });
});

test('debounce at 1s — rapid changes produce single sync call', async () => {
  startWatcher('/test/dir', state);

  handlers['change']('readme.md');
  handlers['change']('readme.md');
  handlers['change']('readme.md');

  // Should NOT fire at 500ms
  await jest.advanceTimersByTimeAsync(500);
  expect(syncFile).not.toHaveBeenCalled();

  // Should fire at 1000ms
  await jest.advanceTimersByTimeAsync(500);
  expect(syncFile).toHaveBeenCalledTimes(1);
});

test('add event triggers syncFile after debounce', async () => {
  startWatcher('/test/dir', state);

  handlers['add']('new-file.md');

  expect(syncFile).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncFile).toHaveBeenCalledTimes(1);
  expect(syncFile).toHaveBeenCalledWith(
    expect.stringContaining('new-file.md'),
    expect.any(String),
    state,
  );
});

test('change event triggers syncFile after debounce', async () => {
  startWatcher('/test/dir', state);

  handlers['change']('existing.md');

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncFile).toHaveBeenCalledTimes(1);
  expect(syncFile).toHaveBeenCalledWith(
    expect.stringContaining('existing.md'),
    expect.any(String),
    state,
  );
});

test('unlink event triggers syncDeleteFile after debounce', async () => {
  startWatcher('/test/dir', state);

  handlers['unlink']('removed.md');

  expect(syncDeleteFile).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncDeleteFile).toHaveBeenCalledTimes(1);
  expect(syncDeleteFile).toHaveBeenCalledWith(
    expect.stringContaining('removed.md'),
    expect.any(String),
    state,
  );
});
