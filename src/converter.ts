import { markdownToBlocks } from '@tryfabric/martian';
import { NotionToMarkdown } from 'notion-to-md';

import { notion } from './notion.js';

const n2m = new NotionToMarkdown({
  notionClient: notion,
});

export const mdToBlocks = (markdown: string): unknown[] => markdownToBlocks(markdown);

export const blocksToMd = async (
  pageId: string,
): Promise<string> => {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const { parent } = n2m.toMarkdownString(mdBlocks);

  return parent;
};
