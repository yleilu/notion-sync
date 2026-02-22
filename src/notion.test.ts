import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterEach,
} from '@jest/globals';

// ── Mock setup ──────────────────────────────────────────────────────────────

const mockBlocksChildrenList = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockBlocksChildrenAppend = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockBlocksDelete = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPagesCreate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPagesUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPagesRetrieve = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const mockEnqueue = jest.fn<(fn: () => Promise<unknown>) => Promise<unknown>
  >();
mockEnqueue.mockImplementation((fn) => fn());

jest.unstable_mockModule('./queue.js', () => ({
  enqueue: mockEnqueue,
}));

jest.unstable_mockModule('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    blocks: {
      children: {
        list: mockBlocksChildrenList,
        append: mockBlocksChildrenAppend,
      },
      delete: mockBlocksDelete,
    },
    pages: {
      create: mockPagesCreate,
      update: mockPagesUpdate,
      retrieve: mockPagesRetrieve,
    },
  })),
}));

// Dynamic import after mocking
let getChildPages: (typeof import('./notion.js'))['getChildPages'];
let createPage: (typeof import('./notion.js'))['createPage'];
let updatePageContent: (typeof import('./notion.js'))['updatePageContent'];
let archivePage: (typeof import('./notion.js'))['archivePage'];
let getPageMeta: (typeof import('./notion.js'))['getPageMeta'];

beforeAll(async () => {
  const mod = await import('./notion.js');
  getChildPages = mod.getChildPages;
  createPage = mod.createPage;
  updatePageContent = mod.updatePageContent;
  archivePage = mod.archivePage;
  getPageMeta = mod.getPageMeta;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── getChildPages ───────────────────────────────────────────────────────────

describe('getChildPages', () => {
  it('filters child_page blocks from response', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: 'p1',
          type: 'child_page',
          child_page: {
            title: 'Page One',
          },
        },
        {
          id: 'b1',
          type: 'paragraph',
          paragraph: {},
        },
        {
          id: 'p2',
          type: 'child_page',
          child_page: {
            title: 'Page Two',
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const pages = await getChildPages('parent-id');

    expect(pages).toEqual([
      {
        id: 'p1',
        title: 'Page One',
      },
      {
        id: 'p2',
        title: 'Page Two',
      },
    ]);
    expect(mockBlocksChildrenList).toHaveBeenCalledWith({
      block_id: 'parent-id',
      start_cursor: undefined,
      page_size: 100,
    });
  });

  it('handles pagination with has_more and next_cursor', async () => {
    mockBlocksChildrenList
      .mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            type: 'child_page',
            child_page: {
              title: 'First',
            },
          },
        ],
        has_more: true,
        next_cursor: 'cursor-abc',
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'p2',
            type: 'child_page',
            child_page: {
              title: 'Second',
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });

    const pages = await getChildPages('parent-id');

    expect(pages).toEqual([
      {
        id: 'p1',
        title: 'First',
      },
      {
        id: 'p2',
        title: 'Second',
      },
    ]);
    expect(mockBlocksChildrenList).toHaveBeenCalledTimes(2);
    expect(mockBlocksChildrenList).toHaveBeenNthCalledWith(
      2,
      {
        block_id: 'parent-id',
        start_cursor: 'cursor-abc',
        page_size: 100,
      },
    );
  });

  it('returns empty array when no child_page blocks exist', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: 'b1',
          type: 'paragraph',
          paragraph: {},
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const pages = await getChildPages('parent-id');

    expect(pages).toEqual([]);
  });
});

// ── createPage ──────────────────────────────────────────────────────────────

describe('createPage', () => {
  it('passes correct params and returns response ID', async () => {
    mockPagesCreate.mockResolvedValueOnce({
      id: 'new-page-id',
    });

    const blocks = [
      {
        type: 'paragraph',
        paragraph: {
          text: 'hello',
        },
      },
    ];
    const id = await createPage(
      'parent-123',
      'My Title',
      blocks,
    );

    expect(id).toBe('new-page-id');
    expect(mockPagesCreate).toHaveBeenCalledWith({
      parent: {
        page_id: 'parent-123',
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: 'My Title',
              },
            },
          ],
        },
      },
      children: blocks,
    });
  });
});

// ── updatePageContent ───────────────────────────────────────────────────────

describe('updatePageContent', () => {
  it('lists existing blocks, deletes them, then appends new blocks', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: 'old-1',
        },
        {
          id: 'old-2',
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksDelete.mockResolvedValue({});
    mockBlocksChildrenAppend.mockResolvedValue({});

    const newBlocks = [
      {
        type: 'paragraph',
      },
    ];
    await updatePageContent('page-id', newBlocks);

    expect(mockBlocksChildrenList).toHaveBeenCalledWith({
      block_id: 'page-id',
      page_size: 100,
    });
    expect(mockBlocksDelete).toHaveBeenCalledTimes(2);
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: 'old-1',
    });
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: 'old-2',
    });
    expect(mockBlocksChildrenAppend).toHaveBeenCalledWith({
      block_id: 'page-id',
      children: newBlocks,
    });
  });

  it('appends new blocks in chunks of 100', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksChildrenAppend.mockResolvedValue({});

    // Create 250 blocks
    const newBlocks = Array.from(
      {
        length: 250,
      },
      (_, i) => ({
        type: 'paragraph',
        id: `block-${i}`,
      }),
    );

    await updatePageContent('page-id', newBlocks);

    expect(mockBlocksChildrenAppend).toHaveBeenCalledTimes(
      3,
    );
    expect(
      mockBlocksChildrenAppend,
    ).toHaveBeenNthCalledWith(1, {
      block_id: 'page-id',
      children: newBlocks.slice(0, 100),
    });
    expect(
      mockBlocksChildrenAppend,
    ).toHaveBeenNthCalledWith(2, {
      block_id: 'page-id',
      children: newBlocks.slice(100, 200),
    });
    expect(
      mockBlocksChildrenAppend,
    ).toHaveBeenNthCalledWith(3, {
      block_id: 'page-id',
      children: newBlocks.slice(200, 250),
    });
  });

  it('returns early when blocks array is empty', async () => {
    await updatePageContent('page-id', []);

    expect(mockBlocksChildrenList).not.toHaveBeenCalled();
    expect(mockBlocksDelete).not.toHaveBeenCalled();
    expect(mockBlocksChildrenAppend).not.toHaveBeenCalled();
  });

  it('skips blocks without id when deleting', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: 'has-id',
        },
        {
          noId: true,
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksDelete.mockResolvedValue({});
    mockBlocksChildrenAppend.mockResolvedValue({});

    await updatePageContent('page-id', [
      {
        type: 'paragraph',
      },
    ]);

    expect(mockBlocksDelete).toHaveBeenCalledTimes(1);
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: 'has-id',
    });
  });
});

// ── archivePage ─────────────────────────────────────────────────────────────

describe('archivePage', () => {
  it('calls notion.pages.update with archived=true', async () => {
    mockPagesUpdate.mockResolvedValueOnce({});

    await archivePage('page-to-archive');

    expect(mockPagesUpdate).toHaveBeenCalledWith({
      page_id: 'page-to-archive',
      archived: true,
    });
  });
});

// ── getPageMeta ─────────────────────────────────────────────────────────────

describe('getPageMeta', () => {
  it('returns lastEditedTime from page retrieve', async () => {
    mockPagesRetrieve.mockResolvedValueOnce({
      last_edited_time: '2025-01-15T10:30:00.000Z',
    });

    const meta = await getPageMeta('page-123');

    expect(meta).toEqual({
      lastEditedTime: '2025-01-15T10:30:00.000Z',
    });
    expect(mockPagesRetrieve).toHaveBeenCalledWith({
      page_id: 'page-123',
    });
  });

  it('throws when page has no last_edited_time', async () => {
    mockPagesRetrieve.mockResolvedValueOnce({
      id: 'page-123',
    });

    await expect(getPageMeta('page-123')).rejects.toThrow(
      'Page page-123 has no last_edited_time',
    );
  });
});

// ── withRetry (tested indirectly) ───────────────────────────────────────────

describe('withRetry (indirect)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries on 429 status with linear backoff', async () => {
    const rateLimitError = {
      status: 429,
      message: 'Rate limited',
    };

    mockPagesUpdate
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({});

    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => {});

    const promise = archivePage('page-id');

    // First retry: wait 1000ms
    await jest.advanceTimersByTimeAsync(1000);
    // Second retry: wait 2000ms
    await jest.advanceTimersByTimeAsync(2000);

    await promise;

    expect(mockPagesUpdate).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Rate limited, retrying in %dms...',
      1000,
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      'Rate limited, retrying in %dms...',
      2000,
    );

    consoleSpy.mockRestore();
  });

  it('throws on non-429 errors without retrying', async () => {
    const serverError = {
      status: 500,
      message: 'Internal Server Error',
    };

    mockPagesRetrieve.mockRejectedValueOnce(serverError);

    await expect(getPageMeta('page-id')).rejects.toEqual(
      serverError,
    );
    expect(mockPagesRetrieve).toHaveBeenCalledTimes(1);
  });

  it('throws 429 error after exhausting all retries', async () => {
    const rateLimitError = {
      status: 429,
      message: 'Rate limited',
    };

    mockPagesUpdate
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError);

    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => {});

    // Attach rejection handler immediately to avoid unhandled rejection warnings
    let caughtError: unknown;
    const promise = archivePage('page-id').catch((err) => {
      caughtError = err;
    });

    // First retry after 429: sleep(1000)
    await jest.advanceTimersByTimeAsync(1000);
    // Second retry after 429: sleep(2000)
    // Third attempt (i=2) fails with 429, but i < retries-1 is false,
    // so it throws immediately without sleeping
    await jest.advanceTimersByTimeAsync(2000);

    await promise;

    expect(caughtError).toEqual(rateLimitError);
    expect(mockPagesUpdate).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });
});

// ── Rate limiting via enqueue ──────────────────────────────────────────────

describe('rate limiting', () => {
  it('all API calls route through enqueue', async () => {
    mockBlocksChildrenList.mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    mockPagesCreate.mockResolvedValue({
      id: 'id',
    });
    mockPagesUpdate.mockResolvedValue({});
    mockPagesRetrieve.mockResolvedValue({
      last_edited_time: 't',
    });
    mockBlocksChildrenAppend.mockResolvedValue({});

    mockEnqueue.mockClear();

    await getChildPages('p');
    await createPage('p', 'T', []);
    await archivePage('p');
    await getPageMeta('p');

    expect(
      mockEnqueue.mock.calls.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('updatePageContent block deletion is sequential, not Promise.all', async () => {
    const callOrder: string[] = [];

    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: 'a',
        },
        {
          id: 'b',
        },
        {
          id: 'c',
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    mockBlocksDelete.mockImplementation(async (arg: unknown) => {
      const { block_id: blockId } = arg as { block_id: string };
      callOrder.push(`delete-start-${blockId}`);
      await new Promise((r) => {
        setTimeout(r, 10);
      });
      callOrder.push(`delete-end-${blockId}`);
    });
    mockBlocksChildrenAppend.mockResolvedValue({});

    await updatePageContent('page-id', [
      {
        type: 'p',
      },
    ]);

    // If sequential, each delete-end comes before next delete-start
    const deleteStarts = callOrder.filter((s) => s.startsWith('delete-start'));
    const deleteEnds = callOrder.filter((s) => s.startsWith('delete-end'));
    expect(deleteStarts.length).toBe(3);
    expect(deleteEnds.length).toBe(3);

    // Verify sequential: delete-end-a before delete-start-b
    expect(callOrder.indexOf('delete-end-a')).toBeLessThan(
      callOrder.indexOf('delete-start-b'),
    );
    expect(callOrder.indexOf('delete-end-b')).toBeLessThan(
      callOrder.indexOf('delete-start-c'),
    );
  });
});
