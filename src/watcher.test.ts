import { resolve } from 'path';

import { jest } from '@jest/globals';

jest.useFakeTimers();

const handlers: Record<
  string,
  (...args: unknown[]) => void
> = {};
const fakeWatcher = {
  on: jest.fn(
    (
      event: string,
      handler: (...args: unknown[]) => void,
    ): typeof fakeWatcher => {
      handlers[event] = handler;
      return fakeWatcher;
    },
  ),
};

jest.unstable_mockModule('chokidar', () => ({
  watch: jest.fn(() => fakeWatcher),
}));

jest.unstable_mockModule('./sync.js', () => ({
  syncFile: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
  syncDeleteFile: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
}));

let startWatcher: (typeof import('./watcher.js'))['startWatcher'];
let watch: jest.Mock;
let syncFile: jest.Mock;
let syncDeleteFile: jest.Mock;

const state = {
  statePageId: 'root-page-id',
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

test('creates watcher with directory path and followSymlinks', () => {
  startWatcher('/test/dir', state);

  expect(watch).toHaveBeenCalledWith(resolve('/test/dir'), {
    ignoreInitial: true,
    followSymlinks: true,
  });
});

test('debounce at 1s — rapid changes produce single sync call', async () => {
  startWatcher('/test/dir', state);
  const absDir = resolve('/test/dir');

  handlers.all('change', resolve(absDir, 'readme.md'));
  handlers.all('change', resolve(absDir, 'readme.md'));
  handlers.all('change', resolve(absDir, 'readme.md'));

  await jest.advanceTimersByTimeAsync(500);
  expect(syncFile).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(500);
  expect(syncFile).toHaveBeenCalledTimes(1);
});

test('add event triggers syncFile after debounce', async () => {
  startWatcher('/test/dir', state);
  const absDir = resolve('/test/dir');
  const absPath = resolve(absDir, 'new-file.md');

  handlers.all('add', absPath);

  expect(syncFile).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncFile).toHaveBeenCalledTimes(1);
  expect(syncFile).toHaveBeenCalledWith(
    absPath,
    absDir,
    state,
  );
});

test('change event triggers syncFile after debounce', async () => {
  startWatcher('/test/dir', state);
  const absDir = resolve('/test/dir');
  const absPath = resolve(absDir, 'existing.md');

  handlers.all('change', absPath);

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncFile).toHaveBeenCalledTimes(1);
  expect(syncFile).toHaveBeenCalledWith(
    absPath,
    absDir,
    state,
  );
});

test('unlink event triggers syncDeleteFile after debounce', async () => {
  startWatcher('/test/dir', state);
  const absDir = resolve('/test/dir');
  const absPath = resolve(absDir, 'removed.md');

  handlers.all('unlink', absPath);

  expect(syncDeleteFile).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncDeleteFile).toHaveBeenCalledTimes(1);
  expect(syncDeleteFile).toHaveBeenCalledWith(
    absPath,
    absDir,
    state,
  );
});

test('ignores non-.md files', async () => {
  startWatcher('/test/dir', state);
  const absDir = resolve('/test/dir');

  handlers.all('change', resolve(absDir, 'image.png'));
  handlers.all('add', resolve(absDir, 'data.json'));

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncFile).not.toHaveBeenCalled();
  expect(syncDeleteFile).not.toHaveBeenCalled();
});

test('handles files in symlinked subdirectories', async () => {
  startWatcher('/test/dir', state);
  const absDir = resolve('/test/dir');
  // chokidar emits absolute path even through symlink
  const absPath = resolve(absDir, 'symlinked-sub/note.md');

  handlers.all('change', absPath);

  await jest.advanceTimersByTimeAsync(1000);

  expect(syncFile).toHaveBeenCalledTimes(1);
  expect(syncFile).toHaveBeenCalledWith(
    absPath,
    absDir,
    state,
  );
});
