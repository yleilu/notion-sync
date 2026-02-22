import { resolve } from 'path';

import { jest } from '@jest/globals';

import type { SyncState } from './state.js';

// ── fs/promises mocks ──────────────────────────────────────────────
const mockReaddir = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockReadFile = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockWriteFile = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);
const mockMkdir = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);
const mockStat = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  stat: mockStat,
}));

// ── state mocks ────────────────────────────────────────────────────
const mockHashContent = jest.fn<(c: string) => string>();
const mockLoadState = jest.fn<() => Promise<unknown>>();
const mockSaveState = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule('./state.js', () => ({
  hashContent: mockHashContent,
  loadState: mockLoadState,
  saveState: mockSaveState,
}));

// ── notion mocks ───────────────────────────────────────────────────
const mockGetChildPages = jest.fn<() => Promise<unknown[]>>();
const mockCreatePage = jest.fn<() => Promise<string>>();
const mockUpdatePageContent = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);
const mockArchivePage = jest
  .fn<() => Promise<undefined>>()
  .mockResolvedValue(undefined);
const mockGetPageMeta = jest.fn<() => Promise<{ lastEditedTime: string }>>();

jest.unstable_mockModule('./notion.js', () => ({
  getChildPages: mockGetChildPages,
  createPage: mockCreatePage,
  updatePageContent: mockUpdatePageContent,
  archivePage: mockArchivePage,
  getPageMeta: mockGetPageMeta,
}));

// ── converter mocks ────────────────────────────────────────────────
const mockMdToBlocks = jest.fn<(md: string) => unknown[]>();
const mockBlocksToMd = jest.fn<() => Promise<string>>();

jest.unstable_mockModule('./converter.js', () => ({
  mdToBlocks: mockMdToBlocks,
  blocksToMd: mockBlocksToMd,
}));

// ── dynamic import (AFTER all mocks are registered) ────────────────
const {
  scanLocal,
  startupSync,
  syncFile,
  syncDeleteFile,
  syncFromNotion,
} = await import('./sync.js');

// ── helpers ────────────────────────────────────────────────────────
const DIR = '/tmp/test-docs';
const ROOT_PAGE = 'root-page-id';
const NOW = '2026-02-22T00:00:00.000Z';

interface DirentLike {
  name: string
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}

const dirent = (
  name: string,
  type: 'file' | 'dir' | 'symlink' = 'file',
): DirentLike => ({
  name,
  isFile: () => type === 'file',
  isDirectory: () => type === 'dir',
  isSymbolicLink: () => type === 'symlink',
});

// ════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════

describe('scanLocal', () => {
  it('finds .md files and directories recursively', async () => {
    // root dir has one md file, one txt file, and a subdir
    mockReaddir
      .mockResolvedValueOnce([
        dirent('readme.md'),
        dirent('image.png'),
        dirent('sub', 'dir'),
      ])
      // sub dir has one md file
      .mockResolvedValueOnce([dirent('nested.md')]);

    const { files, dirs } = await scanLocal(DIR);

    expect(files).toEqual([
      {
        relativePath: 'readme.md',
        absolutePath: resolve(DIR, 'readme.md'),
      },
      {
        relativePath: 'sub/nested.md',
        absolutePath: resolve(DIR, 'sub', 'nested.md'),
      },
    ]);
    expect(dirs).toEqual([
      {
        relativePath: 'sub',
        absolutePath: resolve(DIR, 'sub'),
      },
    ]);
  });

  it('skips non-md files', async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent('notes.txt'),
      dirent('data.json'),
      dirent('script.js'),
    ]);

    const { files, dirs } = await scanLocal(DIR);

    expect(files).toHaveLength(0);
    expect(dirs).toHaveLength(0);
  });

  it('returns empty arrays for empty directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);

    const { files, dirs } = await scanLocal(DIR);

    expect(files).toEqual([]);
    expect(dirs).toEqual([]);
  });
});

describe('sync operations', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startupSync', () => {
    it('creates fresh state when none exists and syncs files', async () => {
      mockLoadState.mockResolvedValueOnce(null);
      // scanLocal: root has one md file
      mockReaddir.mockResolvedValueOnce([
        dirent('hello.md'),
      ]);
      mockReadFile.mockResolvedValueOnce('# Hello');
      mockHashContent.mockReturnValueOnce('hash-hello');
      mockMdToBlocks.mockReturnValueOnce([
        {
          type: 'paragraph',
        },
      ]);
      // syncFile checks siblings before creating
      mockGetChildPages.mockResolvedValueOnce([]);
      mockCreatePage.mockResolvedValueOnce('notion-page-1');
      mockGetPageMeta.mockResolvedValueOnce({
        lastEditedTime: '2026-02-22T01:00:00.000Z',
      });
      // fetchNotionTree calls getChildPages for root
      mockGetChildPages.mockResolvedValueOnce([]);

      const state = await startupSync(DIR, ROOT_PAGE);

      expect(mockLoadState).toHaveBeenCalledWith(
        resolve(DIR),
      );
      expect(state.rootPageId).toBe(ROOT_PAGE);
      expect(state.dirPath).toBe(resolve(DIR));
      expect(state.files['hello.md']).toEqual({
        notionPageId: 'notion-page-1',
        localHash: 'hash-hello',
        notionLastEdited: '2026-02-22T01:00:00.000Z',
        lastSyncedAt: NOW,
      });
      expect(mockSaveState).toHaveBeenCalledWith(
        resolve(DIR),
        state,
      );
    });

    it('skips unchanged files (matching hash)', async () => {
      const existingState = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'hello.md': {
            notionPageId: 'existing-page',
            localHash: 'hash-hello',
            notionLastEdited: '2026-02-21T00:00:00.000Z',
            lastSyncedAt: '2026-02-21T00:00:00.000Z',
          },
        },
        dirs: {},
      };
      mockLoadState.mockResolvedValueOnce(existingState);
      mockReaddir.mockResolvedValueOnce([
        dirent('hello.md'),
      ]);
      mockReadFile.mockResolvedValueOnce('# Hello');
      mockHashContent.mockReturnValueOnce('hash-hello'); // same hash
      // fetchNotionTree calls getChildPages for root
      mockGetChildPages.mockResolvedValueOnce([]);

      const state = await startupSync(DIR, ROOT_PAGE);

      expect(mockCreatePage).not.toHaveBeenCalled();
      expect(mockUpdatePageContent).not.toHaveBeenCalled();
      // File should remain in state unchanged
      expect(state.files['hello.md'].notionPageId).toBe(
        'existing-page',
      );
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('archives removed files from state', async () => {
      const existingState = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'deleted.md': {
            notionPageId: 'page-to-archive',
            localHash: 'hash-old',
            notionLastEdited: '2026-02-20T00:00:00.000Z',
            lastSyncedAt: '2026-02-20T00:00:00.000Z',
          },
        },
        dirs: {},
      };
      mockLoadState.mockResolvedValueOnce(existingState);
      // scanLocal returns empty — no local files
      mockReaddir.mockResolvedValueOnce([]);
      // fetchNotionTree calls getChildPages for root
      mockGetChildPages.mockResolvedValueOnce([]);

      const state = await startupSync(DIR, ROOT_PAGE);

      expect(mockArchivePage).toHaveBeenCalledWith(
        'page-to-archive',
      );
      expect(state.files['deleted.md']).toBeUndefined();
      expect(mockSaveState).toHaveBeenCalled();
    });
  });

  describe('syncFile', () => {
    it('creates new page when file not in state', async () => {
      const state: SyncState = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {},
        dirs: {},
      };
      const filePath = resolve(DIR, 'new-file.md');

      mockReadFile.mockResolvedValueOnce('# New');
      mockHashContent.mockReturnValueOnce('hash-new');
      mockMdToBlocks.mockReturnValueOnce([
        {
          type: 'heading',
        },
      ]);
      mockGetChildPages.mockResolvedValueOnce([]);
      mockCreatePage.mockResolvedValueOnce(
        'created-page-id',
      );
      mockGetPageMeta.mockResolvedValueOnce({
        lastEditedTime: '2026-02-22T02:00:00.000Z',
      });

      await syncFile(filePath, DIR, state);

      expect(mockCreatePage).toHaveBeenCalledWith(
        ROOT_PAGE,
        'new-file',
        [
          {
            type: 'heading',
          },
        ],
      );
      expect(state.files['new-file.md']).toEqual({
        notionPageId: 'created-page-id',
        localHash: 'hash-new',
        notionLastEdited: '2026-02-22T02:00:00.000Z',
        lastSyncedAt: NOW,
      });
      expect(mockSaveState).toHaveBeenCalledWith(
        resolve(DIR),
        state,
      );
    });

    it('updates existing page when hash differs', async () => {
      const state = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'existing.md': {
            notionPageId: 'existing-page-id',
            localHash: 'old-hash',
            notionLastEdited: '2026-02-21T00:00:00.000Z',
            lastSyncedAt: '2026-02-21T00:00:00.000Z',
          },
        },
        dirs: {},
      };
      const filePath = resolve(DIR, 'existing.md');

      mockReadFile.mockResolvedValueOnce('# Updated');
      mockHashContent.mockReturnValueOnce('new-hash');
      mockMdToBlocks.mockReturnValueOnce([
        {
          type: 'paragraph',
        },
      ]);
      mockGetPageMeta.mockResolvedValueOnce({
        lastEditedTime: '2026-02-22T03:00:00.000Z',
      });

      await syncFile(filePath, DIR, state);

      expect(mockUpdatePageContent).toHaveBeenCalledWith(
        'existing-page-id',
        [
          {
            type: 'paragraph',
          },
        ],
      );
      expect(mockCreatePage).not.toHaveBeenCalled();
      expect(state.files['existing.md']).toEqual({
        notionPageId: 'existing-page-id',
        localHash: 'new-hash',
        notionLastEdited: '2026-02-22T03:00:00.000Z',
        lastSyncedAt: NOW,
      });
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('skips when hash matches', async () => {
      const state = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'unchanged.md': {
            notionPageId: 'page-id',
            localHash: 'same-hash',
            notionLastEdited: '2026-02-21T00:00:00.000Z',
            lastSyncedAt: '2026-02-21T00:00:00.000Z',
          },
        },
        dirs: {},
      };
      const filePath = resolve(DIR, 'unchanged.md');

      mockReadFile.mockResolvedValueOnce('# Unchanged');
      mockHashContent.mockReturnValueOnce('same-hash');

      await syncFile(filePath, DIR, state);

      expect(mockCreatePage).not.toHaveBeenCalled();
      expect(mockUpdatePageContent).not.toHaveBeenCalled();
      expect(mockSaveState).not.toHaveBeenCalled();
    });
  });

  describe('syncDeleteFile', () => {
    it('archives page and removes from state', async () => {
      const state = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'to-delete.md': {
            notionPageId: 'delete-page-id',
            localHash: 'some-hash',
            notionLastEdited: '2026-02-21T00:00:00.000Z',
            lastSyncedAt: '2026-02-21T00:00:00.000Z',
          },
        },
        dirs: {},
      };
      const filePath = resolve(DIR, 'to-delete.md');

      await syncDeleteFile(filePath, DIR, state);

      expect(mockArchivePage).toHaveBeenCalledWith(
        'delete-page-id',
      );
      expect(state.files['to-delete.md']).toBeUndefined();
      expect(mockSaveState).toHaveBeenCalledWith(
        resolve(DIR),
        state,
      );
    });

    it('no-op when file not tracked in state', async () => {
      const state: SyncState = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {},
        dirs: {},
      };
      const filePath = resolve(DIR, 'unknown.md');

      await syncDeleteFile(filePath, DIR, state);

      expect(mockArchivePage).not.toHaveBeenCalled();
      expect(mockSaveState).not.toHaveBeenCalled();
    });
  });

  describe('syncFromNotion', () => {
    it('pulls changed content when lastEditedTime differs', async () => {
      const state = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'doc.md': {
            notionPageId: 'notion-doc-id',
            localHash: 'old-hash',
            notionLastEdited: '2026-02-20T00:00:00.000Z',
            lastSyncedAt: '2026-02-20T00:00:00.000Z',
          },
        },
        dirs: {},
      };

      mockGetPageMeta.mockResolvedValueOnce({
        lastEditedTime: '2026-02-22T05:00:00.000Z',
      });
      mockBlocksToMd.mockResolvedValueOnce(
        '# Updated from Notion',
      );
      mockHashContent.mockReturnValueOnce('new-notion-hash');

      await syncFromNotion(DIR, state);

      expect(mockBlocksToMd).toHaveBeenCalledWith(
        'notion-doc-id',
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        resolve(resolve(DIR), '.'),
        {
          recursive: true,
        },
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(resolve(DIR), 'doc.md'),
        '# Updated from Notion',
      );
      expect(state.files['doc.md']).toEqual({
        notionPageId: 'notion-doc-id',
        localHash: 'new-notion-hash',
        notionLastEdited: '2026-02-22T05:00:00.000Z',
        lastSyncedAt: NOW,
      });
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('skips unchanged files (same lastEditedTime)', async () => {
      const state = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'unchanged.md': {
            notionPageId: 'notion-unchanged-id',
            localHash: 'hash-1',
            notionLastEdited: '2026-02-21T00:00:00.000Z',
            lastSyncedAt: '2026-02-21T00:00:00.000Z',
          },
        },
        dirs: {},
      };

      mockGetPageMeta.mockResolvedValueOnce({
        lastEditedTime: '2026-02-21T00:00:00.000Z',
      });

      await syncFromNotion(DIR, state);

      expect(mockBlocksToMd).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      // State should remain unchanged
      expect(state.files['unchanged.md'].localHash).toBe(
        'hash-1',
      );
      expect(mockSaveState).toHaveBeenCalled();
    });

    it('handles errors per file without stopping others', async () => {
      const state = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'error-file.md': {
            notionPageId: 'notion-error-id',
            localHash: 'hash-e',
            notionLastEdited: '2026-02-20T00:00:00.000Z',
            lastSyncedAt: '2026-02-20T00:00:00.000Z',
          },
          'ok-file.md': {
            notionPageId: 'notion-ok-id',
            localHash: 'hash-ok',
            notionLastEdited: '2026-02-20T00:00:00.000Z',
            lastSyncedAt: '2026-02-20T00:00:00.000Z',
          },
        },
        dirs: {},
      };

      // First file throws
      mockGetPageMeta
        .mockRejectedValueOnce(
          new Error('Notion API error'),
        )
        // Second file succeeds but unchanged
        .mockResolvedValueOnce({
          lastEditedTime: '2026-02-20T00:00:00.000Z',
        });

      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await syncFromNotion(DIR, state);

      // Should not throw, should continue to second file
      expect(mockGetPageMeta).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error checking %s:',
        'error-file.md',
        expect.any(Error),
      );
      // State for error file should be unchanged
      expect(state.files['error-file.md'].localHash).toBe(
        'hash-e',
      );
      expect(mockSaveState).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('syncFile under symlinked dir', () => {
    it('updates existing page when file is inside a symlinked subdir', async () => {
      // Simulate state after startupSync tracked a file under symlinked dir "test"
      const state: SyncState = {
        rootPageId: ROOT_PAGE,
        dirPath: resolve(DIR),
        files: {
          'test/test-md.md': {
            notionPageId: 'symlink-page-id',
            localHash: 'old-hash',
            notionLastEdited: '2026-02-21T00:00:00.000Z',
            lastSyncedAt: '2026-02-21T00:00:00.000Z',
          },
        },
        dirs: {
          test: {
            notionPageId: 'test-dir-page-id',
          },
        },
      };

      // Chokidar emits relPath "test/test-md.md", watcher resolves to abs path
      const absPath = resolve(DIR, 'test/test-md.md');

      mockReadFile.mockResolvedValueOnce(
        '# Updated content',
      );
      mockHashContent.mockReturnValueOnce('new-hash');
      mockMdToBlocks.mockReturnValueOnce([
        {
          type: 'paragraph',
        },
      ]);
      mockGetPageMeta.mockResolvedValueOnce({
        lastEditedTime: '2026-02-22T05:00:00.000Z',
      });

      await syncFile(absPath, DIR, state);

      // Should UPDATE existing page, not create a new one
      expect(mockUpdatePageContent).toHaveBeenCalledWith(
        'symlink-page-id',
        [
          {
            type: 'paragraph',
          },
        ],
      );
      expect(mockCreatePage).not.toHaveBeenCalled();
      expect(state.files['test/test-md.md']).toEqual({
        notionPageId: 'symlink-page-id',
        localHash: 'new-hash',
        notionLastEdited: '2026-02-22T05:00:00.000Z',
        lastSyncedAt: NOW,
      });
    });
  });
});
