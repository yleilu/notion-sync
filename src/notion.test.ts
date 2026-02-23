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
const mockBlocksUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
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
      update: mockBlocksUpdate,
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
          id: '00000000-0000-0000-0000-00000000a001',
          type: 'child_page',
          child_page: {
            title: 'Page One',
          },
        },
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {},
        },
        {
          id: '00000000-0000-0000-0000-00000000a002',
          type: 'child_page',
          child_page: {
            title: 'Page Two',
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const pages = await getChildPages(
      '00000000-0000-0000-0000-000000000010',
    );

    expect(pages).toEqual([
      {
        id: '00000000-0000-0000-0000-00000000a001',
        title: 'Page One',
      },
      {
        id: '00000000-0000-0000-0000-00000000a002',
        title: 'Page Two',
      },
    ]);
    expect(mockBlocksChildrenList).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-000000000010',
      start_cursor: undefined,
      page_size: 100,
    });
  });

  it('handles pagination with has_more and next_cursor', async () => {
    mockBlocksChildrenList
      .mockResolvedValueOnce({
        results: [
          {
            id: '00000000-0000-0000-0000-00000000a001',
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
            id: '00000000-0000-0000-0000-00000000a002',
            type: 'child_page',
            child_page: {
              title: 'Second',
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });

    const pages = await getChildPages(
      '00000000-0000-0000-0000-000000000010',
    );

    expect(pages).toEqual([
      {
        id: '00000000-0000-0000-0000-00000000a001',
        title: 'First',
      },
      {
        id: '00000000-0000-0000-0000-00000000a002',
        title: 'Second',
      },
    ]);
    expect(mockBlocksChildrenList).toHaveBeenCalledTimes(2);
    expect(mockBlocksChildrenList).toHaveBeenNthCalledWith(
      2,
      {
        block_id: '00000000-0000-0000-0000-000000000010',
        start_cursor: 'cursor-abc',
        page_size: 100,
      },
    );
  });

  it('returns empty array when no child_page blocks exist', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {},
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    const pages = await getChildPages(
      '00000000-0000-0000-0000-000000000010',
    );

    expect(pages).toEqual([]);
  });
});

// ── createPage ──────────────────────────────────────────────────────────────

describe('createPage', () => {
  it('passes correct params and returns response ID', async () => {
    mockPagesCreate.mockResolvedValueOnce({
      id: 'new-00000000-0000-0000-0000-000000000001',
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
      '00000000-0000-0000-0000-000000000123',
      'My Title',
      blocks,
    );

    expect(id).toBe(
      'new-00000000-0000-0000-0000-000000000001',
    );
    expect(mockPagesCreate).toHaveBeenCalledWith({
      parent: {
        page_id: '00000000-0000-0000-0000-000000000123',
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

  it('chunks blocks >100 into create + append calls', async () => {
    const PAGE_ID = 'new-chunked-page';
    mockPagesCreate.mockResolvedValueOnce({
      id: PAGE_ID,
    });
    mockBlocksChildrenAppend.mockResolvedValue({
      results: [],
    });

    // Generate 250 blocks (first 100 in create, 100 in 2nd chunk, 50 in 3rd)
    const blocks = Array.from({
      length: 250,
    }, (_, i) => ({
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content: `block-${i}`,
            },
          },
        ],
      },
    }));

    const id = await createPage(
      '00000000-0000-0000-0000-000000000123',
      'Big Page',
      blocks,
    );

    expect(id).toBe(PAGE_ID);

    // pages.create receives first 100 blocks
    expect(mockPagesCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockPagesCreate.mock.calls[0][0] as {
      children: unknown[]
    };
    expect(createArgs.children).toHaveLength(100);

    // Two append calls for remaining 150 blocks (100 + 50)
    expect(mockBlocksChildrenAppend).toHaveBeenCalledTimes(
      2,
    );

    const firstAppend = mockBlocksChildrenAppend.mock
      .calls[0][0] as {
      block_id: string
      children: unknown[]
    };
    expect(firstAppend.block_id).toBe(PAGE_ID);
    expect(firstAppend.children).toHaveLength(100);

    const secondAppend = mockBlocksChildrenAppend.mock
      .calls[1][0] as {
      block_id: string
      children: unknown[]
    };
    expect(secondAppend.block_id).toBe(PAGE_ID);
    expect(secondAppend.children).toHaveLength(50);
  });
});

// ── updatePageContent ───────────────────────────────────────────────────────

describe('updatePageContent', () => {
  it('skips unchanged blocks (no API calls for identical content)', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'hello',
              },
            ],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'hello',
                },
              },
            ],
          },
        },
      ],
    );

    expect(mockBlocksDelete).not.toHaveBeenCalled();
    expect(mockBlocksUpdate).not.toHaveBeenCalled();
    expect(mockBlocksChildrenAppend).not.toHaveBeenCalled();
  });

  it('inserts new block in middle with after parameter', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'a',
              },
            ],
          },
        },
        {
          id: '00000000-0000-0000-0000-00000000b002',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'b',
              },
            ],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksChildrenAppend.mockResolvedValue({
      results: [
        {
          id: 'mock-inserted',
        },
      ],
    });

    const insertBlock = {
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content: 'X',
            },
          },
        ],
      },
    };

    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'a',
                },
              },
            ],
          },
        },
        insertBlock,
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'b',
                },
              },
            ],
          },
        },
      ],
    );

    expect(mockBlocksChildrenAppend).toHaveBeenCalledTimes(
      1,
    );
    expect(mockBlocksChildrenAppend).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-000000000001',
      children: [insertBlock],
      after: '00000000-0000-0000-0000-00000000b001',
    });
    expect(mockBlocksDelete).not.toHaveBeenCalled();
  });

  it('inserts at start with no after parameter', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'a',
              },
            ],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksChildrenAppend.mockResolvedValue({
      results: [
        {
          id: 'mock-inserted',
        },
      ],
    });

    const insertBlock = {
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content: 'X',
            },
          },
        ],
      },
    };

    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [
        insertBlock,
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'a',
                },
              },
            ],
          },
        },
      ],
    );

    // Leading insert triggers delete-all + re-append fallback
    expect(mockBlocksDelete).toHaveBeenCalledTimes(1);
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-00000000b001',
    });

    // Re-appends all desired blocks sequentially
    expect(mockBlocksChildrenAppend).toHaveBeenCalledTimes(
      2,
    );
    expect(
      mockBlocksChildrenAppend,
    ).toHaveBeenNthCalledWith(1, {
      block_id: '00000000-0000-0000-0000-000000000001',
      children: [insertBlock],
      after: undefined,
    });
  });

  it('deletes removed blocks', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'a',
              },
            ],
          },
        },
        {
          id: '00000000-0000-0000-0000-00000000b002',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'b',
              },
            ],
          },
        },
        {
          id: '00000000-0000-0000-0000-00000000b003',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'c',
              },
            ],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksDelete.mockResolvedValue({});

    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'a',
                },
              },
            ],
          },
        },
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'c',
                },
              },
            ],
          },
        },
      ],
    );

    expect(mockBlocksDelete).toHaveBeenCalledTimes(1);
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-00000000b002',
    });
    expect(mockBlocksChildrenAppend).not.toHaveBeenCalled();
  });

  it('handles type mismatch via delete + insert', async () => {
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'a',
              },
            ],
          },
        },
        {
          id: '00000000-0000-0000-0000-00000000b002',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'b',
              },
            ],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    mockBlocksDelete.mockResolvedValue({});
    mockBlocksChildrenAppend.mockResolvedValue({
      results: [
        {
          id: 'mock-inserted',
        },
      ],
    });

    const h1Block = {
      type: 'heading_1',
      heading_1: {
        rich_text: [
          {
            text: {
              content: 'a',
            },
          },
        ],
      },
    };
    const pBlock = {
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content: 'c',
            },
          },
        ],
      },
    };

    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [h1Block, pBlock],
    );

    // Type mismatch → delete all old, insert all new
    expect(mockBlocksDelete).toHaveBeenCalledTimes(2);
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-00000000b001',
    });
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-00000000b002',
    });
    expect(mockBlocksChildrenAppend).toHaveBeenCalledTimes(
      2,
    );
    expect(mockBlocksUpdate).not.toHaveBeenCalled();
  });

  it('returns early when blocks array is empty', async () => {
    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [],
    );

    expect(mockBlocksChildrenList).not.toHaveBeenCalled();
    expect(mockBlocksDelete).not.toHaveBeenCalled();
    expect(mockBlocksChildrenAppend).not.toHaveBeenCalled();
  });

  it('paginates when fetching existing blocks', async () => {
    mockBlocksChildrenList
      .mockResolvedValueOnce({
        results: [
          {
            id: '00000000-0000-0000-0000-00000000b001',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  plain_text: 'a',
                },
              ],
            },
          },
        ],
        has_more: true,
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: '00000000-0000-0000-0000-00000000b002',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  plain_text: 'b',
                },
              ],
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    mockBlocksDelete.mockResolvedValue({});

    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'a',
                },
              },
            ],
          },
        },
      ],
    );

    expect(mockBlocksChildrenList).toHaveBeenCalledTimes(2);
    expect(mockBlocksChildrenList).toHaveBeenNthCalledWith(
      2,
      {
        block_id: '00000000-0000-0000-0000-000000000001',
        start_cursor: 'cursor-1',
        page_size: 100,
      },
    );
    // b1 kept, b2 deleted
    expect(mockBlocksDelete).toHaveBeenCalledTimes(1);
    expect(mockBlocksDelete).toHaveBeenCalledWith({
      block_id: '00000000-0000-0000-0000-00000000b002',
    });
  });

  it('operations are sequential, not parallel', async () => {
    const callOrder: string[] = [];

    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [
        {
          id: '00000000-0000-0000-0000-00000000b001',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'a',
              },
            ],
          },
        },
        {
          id: '00000000-0000-0000-0000-00000000b002',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                plain_text: 'b',
              },
            ],
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    mockBlocksDelete.mockImplementation(
      async (arg: unknown) => {
        const { block_id: blockId } = arg as {
          block_id: string
        };
        callOrder.push(`delete-start-${blockId}`);
        await new Promise((r) => {
          setTimeout(r, 10);
        });
        callOrder.push(`delete-end-${blockId}`);
      },
    );
    mockBlocksChildrenAppend.mockImplementation(
      async () => {
        callOrder.push('insert-start');
        await new Promise((r) => {
          setTimeout(r, 10);
        });
        callOrder.push('insert-end');
      },
    );

    const insertBlock = {
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content: 'X',
            },
          },
        ],
      },
    };

    // Old: [a, b], New: [X] → delete a, delete b, insert X
    await updatePageContent(
      '00000000-0000-0000-0000-000000000001',
      [insertBlock],
    );

    // Verify sequential: each op completes before next starts
    for (let i = 0; i < callOrder.length - 1; i += 2) {
      const startIdx = i;
      const endIdx = i + 1;
      expect(callOrder[endIdx]).toContain(
        callOrder[startIdx]
          .replace('-start', '-end')
          .replace(
            `-${callOrder[startIdx].split('-').pop()}`,
            '',
          ),
      );
    }
    // Simpler check: last delete-end before first insert-start
    let lastDeleteEnd = -1;
    callOrder.forEach((c: string, idx: number) => {
      if (c.startsWith('delete-end')) lastDeleteEnd = idx;
    });
    const firstInsertStart = callOrder.indexOf('insert-start');
    if (lastDeleteEnd >= 0 && firstInsertStart >= 0) {
      expect(lastDeleteEnd).toBeLessThan(firstInsertStart);
    }
  });
});

// ── archivePage ─────────────────────────────────────────────────────────────

describe('archivePage', () => {
  it('calls notion.pages.update with archived=true', async () => {
    mockPagesUpdate.mockResolvedValueOnce({});

    await archivePage(
      '00000000-0000-0000-0000-000000000099',
    );

    expect(mockPagesUpdate).toHaveBeenCalledWith({
      page_id: '00000000-0000-0000-0000-000000000099',
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

    const meta = await getPageMeta(
      '00000000-0000-0000-0000-000000000abc',
    );

    expect(meta).toEqual({
      lastEditedTime: '2025-01-15T10:30:00.000Z',
    });
    expect(mockPagesRetrieve).toHaveBeenCalledWith({
      page_id: '00000000-0000-0000-0000-000000000abc',
    });
  });

  it('throws when page has no last_edited_time', async () => {
    mockPagesRetrieve.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000abc',
    });

    await expect(
      getPageMeta('00000000-0000-0000-0000-000000000abc'),
    ).rejects.toThrow(
      'Page 00000000-0000-0000-0000-000000000abc has no last_edited_time',
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

    const promise = archivePage(
      '00000000-0000-0000-0000-000000000001',
    );

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

    await expect(
      getPageMeta('00000000-0000-0000-0000-000000000001'),
    ).rejects.toEqual(serverError);
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
    const promise = archivePage(
      '00000000-0000-0000-0000-000000000001',
    ).catch((err) => {
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
    mockBlocksChildrenAppend.mockResolvedValue({
      results: [
        {
          id: 'mock-inserted',
        },
      ],
    });

    mockEnqueue.mockClear();

    await getChildPages('p');
    await createPage('p', 'T', []);
    await archivePage('p');
    await getPageMeta('p');

    expect(
      mockEnqueue.mock.calls.length,
    ).toBeGreaterThanOrEqual(4);
  });
});
