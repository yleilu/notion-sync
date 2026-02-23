import { resolve } from 'path';
import { createHash } from 'crypto';

import { jest } from '@jest/globals';

const mockMkdir = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);
const mockReadFile = jest.fn<() => Promise<string>>();
const mockWriteFile = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);
const mockUnlink = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);

const mockReaddir = jest.fn<() => Promise<string[]>>();

jest.unstable_mockModule('fs/promises', () => ({
  mkdir: mockMkdir,
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

const {
  hashContent,
  getStateDir,
  loadState,
  saveState,
  writePid,
  readPid,
  cleanPid,
} = await import('./state.js');

const TEST_DIR = '/tmp/test-project';
const TEST_PAGE_ID = 'test-page-id';
const HOME = process.env.HOME ?? '';
const BASE_DIR = resolve(HOME, '.notion-sync');

const expectedHash = (dirPath: string, pageId: string): string => createHash('sha256')
  .update(`${pageId}:${resolve(dirPath)}`)
  .digest('hex')
  .slice(0, 7);

describe('hashContent', () => {
  it('returns consistent SHA-256 hex output', () => {
    const result = hashContent('hello world');
    const expected = createHash('sha256')
      .update('hello world')
      .digest('hex');

    expect(result).toBe(expected);
    expect(result).toHaveLength(64);
  });

  it('returns different hashes for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

  it('returns same hash for same content', () => {
    expect(hashContent('foo')).toBe(hashContent('foo'));
  });
});

describe('getStateDir', () => {
  it('returns ~/.notion-sync/<7-char-hash>/ format', () => {
    const result = getStateDir(TEST_DIR, TEST_PAGE_ID);
    const hash = expectedHash(TEST_DIR, TEST_PAGE_ID);

    expect(result).toBe(resolve(BASE_DIR, hash));
    expect(hash).toHaveLength(7);
  });

  it('resolves relative paths before hashing', () => {
    const abs = getStateDir('/tmp/test-project', TEST_PAGE_ID);
    const rel = getStateDir('/tmp/../tmp/test-project', TEST_PAGE_ID);

    expect(abs).toBe(rel);
  });
});

describe('loadState', () => {
  const sampleState = {
    statePageId: TEST_PAGE_ID,
    rootPageId: 'page-123',
    dirPath: TEST_DIR,
    files: {},
    dirs: {},
  };

  it('returns parsed JSON when file exists', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify(sampleState),
    );

    const result = await loadState(TEST_DIR, TEST_PAGE_ID);

    expect(result).toEqual(sampleState);
    const expectedPath = resolve(
      BASE_DIR,
      expectedHash(TEST_DIR, TEST_PAGE_ID),
      'state.json',
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      expectedPath,
      'utf-8',
    );
  });

  it('returns null when file is missing', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await loadState(TEST_DIR, TEST_PAGE_ID);

    expect(result).toBeNull();
  });
});

describe('saveState', () => {
  const sampleState = {
    statePageId: 'state-456',
    rootPageId: 'page-456',
    dirPath: TEST_DIR,
    files: {},
    dirs: {},
  };

  it('creates directory and writes JSON', async () => {
    await saveState(TEST_DIR, sampleState);

    const stateDir = resolve(
      BASE_DIR,
      expectedHash(TEST_DIR, sampleState.statePageId),
    );
    expect(mockMkdir).toHaveBeenCalledWith(stateDir, {
      recursive: true,
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolve(stateDir, 'state.json'),
      JSON.stringify(sampleState, null, 2),
    );
  });
});

describe('writePid', () => {
  it('creates directory and writes process pid', async () => {
    await writePid(TEST_DIR, TEST_PAGE_ID);

    const stateDir = resolve(
      BASE_DIR,
      expectedHash(TEST_DIR, TEST_PAGE_ID),
    );
    expect(mockMkdir).toHaveBeenCalledWith(stateDir, {
      recursive: true,
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolve(stateDir, 'daemon.pid'),
      String(process.pid),
    );
  });
});

describe('readPid', () => {
  it('returns pid number when file exists', async () => {
    mockReadFile.mockResolvedValueOnce('12345\n');

    const result = await readPid(TEST_DIR, TEST_PAGE_ID);

    expect(result).toBe(12345);
    const expectedPath = resolve(
      BASE_DIR,
      expectedHash(TEST_DIR, TEST_PAGE_ID),
      'daemon.pid',
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      expectedPath,
      'utf-8',
    );
  });

  it('returns null when file is missing', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await readPid(TEST_DIR, TEST_PAGE_ID);

    expect(result).toBeNull();
  });
});

describe('cleanPid', () => {
  it('unlinks the pid file', async () => {
    await cleanPid(TEST_DIR, TEST_PAGE_ID);

    const expectedPath = resolve(
      BASE_DIR,
      expectedHash(TEST_DIR, TEST_PAGE_ID),
      'daemon.pid',
    );
    expect(mockUnlink).toHaveBeenCalledWith(expectedPath);
  });

  it('does not throw when file is already removed', async () => {
    mockUnlink.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(
      cleanPid(TEST_DIR, TEST_PAGE_ID),
    ).resolves.toBeUndefined();
  });
});
