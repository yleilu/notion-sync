import { appendFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

import { Client } from '@notionhq/client';

import { diffBlocks, getBlockContent } from './diff.js';
import { enqueue } from './queue.js';
import { sleep } from './sleep.js';

const DEBUG_LOG = resolve(homedir(), '.notion-sync', 'debug.jsonl');

const debugLog = (entry: Record<string, unknown>): void => {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  });
  try { appendFileSync(DEBUG_LOG, `${line}\n`); } catch { /* ignore */ }
};

const notion = new Client({
  auth: process.env.NOTION_SYNC_API_SECRET,
});

const withRetry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
): Promise<T> => {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = err && typeof err === 'object' && 'status' in err
        ? (err as { status: number }).status
        : 0;
      if (status === 429 && i < retries - 1) {
        const wait = (i + 1) * 1e3;
        console.log(
          'Rate limited, retrying in %dms...',
          wait,
        );
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }

  throw new Error('Unreachable');
};

export interface ChildPage {
  id: string
  title: string
}

export const getChildPages = async (
  pageId: string,
): Promise<ChildPage[]> => {
  const pages: ChildPage[] = [];
  let cursor: string | undefined;

  do {
    const startCursor = cursor;
    const response = await enqueue(() => withRetry(() => notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
      page_size: 100,
    })));

    const childPages = response.results.filter(
      (
        block,
      ): block is typeof block & {
        type: 'child_page'
        child_page: { title: string }
      } => 'type' in block && block.type === 'child_page',
    );
    childPages.forEach((block) => {
      pages.push({
        id: block.id,
        title: block.child_page.title,
      });
    });

    cursor = response.has_more
      ? (response.next_cursor ?? undefined)
      : undefined;
  } while (cursor);

  return pages;
};

export const createPage = async (
  parentId: string,
  title: string,
  blocks: unknown[],
): Promise<string> => {
  const response = await enqueue(() => withRetry(() => notion.pages.create({
    parent: {
      page_id: parentId,
    },
    properties: {
      title: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
    },
    children: blocks as Parameters<
          typeof notion.pages.create
        >[0]['children'],
  })));

  return response.id;
};

type AppendChildren = Parameters<typeof notion.blocks.children.append>[0]['children'];

export const updatePageContent = async (
  pageId: string,
  blocks: unknown[],
  caller?: string,
): Promise<void> => {
  const callId = Math.random().toString(36).slice(2, 8);
  debugLog({
    event: 'updatePageContent:enter',
    callId,
    caller,
    pageId,
    newBlockCount: blocks.length,
    newBlocks: blocks.map((b) => getBlockContent(b)),
    stack: new Error().stack?.split('\n').slice(1, 5).map((s) => s.trim()),
  });

  if (blocks.length === 0) {
    debugLog({
      event: 'updatePageContent:empty', callId,
    });
    return;
  }

  // Fetch all existing blocks with pagination
  const existingBlocks: unknown[] = [];
  let cursor: string | undefined;

  do {
    const startCursor = cursor;
    const response = await enqueue(() => withRetry(() => notion.blocks.children.list({
      block_id: pageId,
      ...(startCursor
        ? {
          start_cursor: startCursor,
        }
        : {}),
      page_size: 100,
    })));

    existingBlocks.push(
      ...response.results.filter(
        (b) => 'id' in b && !('archived' in b && b.archived),
      ),
    );

    cursor = response.has_more
      ? (response.next_cursor ?? undefined)
      : undefined;
  } while (cursor);

  const ops = diffBlocks(existingBlocks, blocks);

  debugLog({
    event: 'updatePageContent:diff',
    callId,
    existingCount: existingBlocks.length,
    existingBlocks: existingBlocks.map((b) => ({
      id: (b as { id?: string }).id,
      ...getBlockContent(b),
    })),
    ops: ops.map((op) => {
      if (op.type === 'keep') {
        return {
          type: 'keep', blockId: op.blockId,
        };
      }
      if (op.type === 'delete') {
        return {
          type: 'delete', blockId: op.blockId,
        };
      }
      if (op.type === 'update') {
        return {
          type: 'update', blockId: op.blockId, new: getBlockContent(op.newBlock),
        };
      }
      if (op.type === 'insert') {
        return {
          type: 'insert', afterBlockId: op.afterBlockId, new: getBlockContent(op.newBlock),
        };
      }
      return op;
    }),
  });

  // Check if there are leading inserts (afterBlockId = null).
  // Notion's append API has no "prepend" — blocks without `after` go to the end.
  // When new blocks must appear before all existing blocks, fall back to
  // delete-all + re-append so ordering is guaranteed.
  const hasLeadingInsert = ops.length > 0
    && ops[0].type === 'insert'
    && ops.some((op) => op.type === 'keep');

  if (hasLeadingInsert) {
    debugLog({
      event: 'updatePageContent:leadingInsertFallback', callId,
    });
    // Delete all existing blocks, then append the full desired state
    await existingBlocks.reduce(
      (chain: Promise<void>, block) => chain.then(async () => {
        const { id } = (block as { id: string });
        if (id) {
          await enqueue(() => withRetry(() => notion.blocks.delete({
            block_id: id,
          })));
        }
      }),
      Promise.resolve(),
    );

    // Append all desired blocks sequentially (chained for correct order)
    let lastId: string | null = null;
    await blocks.reduce(
      (chain: Promise<void>, block) => chain.then(async () => {
        const response = await enqueue(() => withRetry(() => notion.blocks.children.append({
          block_id: pageId,
          children: [block] as AppendChildren,
          after: lastId ?? undefined,
        })));
        const created = response.results[0];
        lastId = created && 'id' in created ? created.id : null;
      }),
      Promise.resolve(),
    );

    return;
  }

  // Track the last inserted block ID for chaining consecutive inserts
  let lastInsertedId: string | null = null;

  // Execute ops sequentially
  await ops.reduce(
    (chain, op) => chain.then(async () => {
      if (op.type === 'delete') {
        lastInsertedId = null;
        await enqueue(() => withRetry(() => notion.blocks.delete({
          block_id: op.blockId,
        })));
      } else if (op.type === 'keep') {
        lastInsertedId = null;
      } else if (op.type === 'update') {
        lastInsertedId = null;
        const block = op.newBlock as Record<string, unknown>;
        const blockType = block.type as string;
        await enqueue(() => withRetry(() => notion.blocks.update({
          block_id: op.blockId,
          [blockType]: block[blockType],
        })));
      } else if (op.type === 'insert') {
        const afterId = lastInsertedId ?? op.afterBlockId;
        const response = await enqueue(() => withRetry(() => notion.blocks.children.append({
          block_id: pageId,
          children: [op.newBlock] as AppendChildren,
          after: afterId ?? undefined,
        })));
        const created = response.results[0];
        lastInsertedId = created && 'id' in created
          ? created.id
          : null;
      }
    }),
    Promise.resolve(),
  );
};

export const archivePage = async (
  pageId: string,
): Promise<void> => {
  await enqueue(() => withRetry(() => notion.pages.update({
    page_id: pageId,
    archived: true,
  })));
};

export const getPageMeta = async (
  pageId: string,
): Promise<{ lastEditedTime: string }> => {
  const page = await enqueue(() => withRetry(() => notion.pages.retrieve({
    page_id: pageId,
  })));

  if (!('last_edited_time' in page)) {
    throw new Error(
      `Page ${pageId} has no last_edited_time`,
    );
  }

  return {
    lastEditedTime: page.last_edited_time,
  };
};

export { notion };
