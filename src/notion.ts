import { Client } from '@notionhq/client';

import { enqueue } from './queue.js';

const notion = new Client({
  auth: process.env.NOTION_SYNC_API_SECRET,
});

const sleep = (ms: number): Promise<void> => new Promise((r) => {
  setTimeout(r, ms);
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

export const updatePageContent = async (
  pageId: string,
  blocks: unknown[],
): Promise<void> => {
  const existing = await enqueue(() => withRetry(() => notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  })));

  // Delete all existing blocks sequentially
  for (const block of existing.results.filter((b) => 'id' in b)) {
    await enqueue(() => withRetry(() => notion.blocks.delete({
      block_id: block.id,
    })));
  }

  // Append new blocks in chunks of 100
  const chunks = Array.from(
    {
      length: Math.ceil(blocks.length / 100),
    },
    (_, i) => blocks.slice(i * 100, (i + 1) * 100),
  );
  for (const chunk of chunks) {
    await enqueue(() => withRetry(() => notion.blocks.children.append({
      block_id: pageId,
      children: chunk as Parameters<
          typeof notion.blocks.children.append
        >[0]['children'],
    })));
  }
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
    throw new Error('Page %s has no last_edited_time');
  }

  return {
    lastEditedTime: page.last_edited_time,
  };
};

export { notion };
