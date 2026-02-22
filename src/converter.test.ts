import { jest } from '@jest/globals';

const mockMarkdownToBlocks = jest.fn<(...args: unknown[]) => unknown>();
const mockPageToMarkdown = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockToMarkdownString = jest.fn<(...args: unknown[]) => unknown>();

jest.unstable_mockModule('./notion.js', () => ({
  notion: {},
}));

jest.unstable_mockModule('@tryfabric/martian', () => ({
  markdownToBlocks: mockMarkdownToBlocks,
}));

jest.unstable_mockModule('notion-to-md', () => ({
  NotionToMarkdown: jest.fn().mockImplementation(() => ({
    pageToMarkdown: mockPageToMarkdown,
    toMarkdownString: mockToMarkdownString,
  })),
}));

const { mdToBlocks, blocksToMd } = await import('./converter.js');

describe('converter', () => {
  describe('mdToBlocks', () => {
    it('calls markdownToBlocks and returns blocks array', () => {
      const fakeBlocks = [
        {
          type: 'paragraph',
          paragraph: {},
        },
      ];
      mockMarkdownToBlocks.mockReturnValue(fakeBlocks);

      const result = mdToBlocks('# Hello');

      expect(mockMarkdownToBlocks).toHaveBeenCalledWith(
        '# Hello',
      );
      expect(result).toBe(fakeBlocks);
    });
  });

  describe('blocksToMd', () => {
    it('calls n2m.pageToMarkdown + toMarkdownString and returns markdown string', async () => {
      const fakeMdBlocks = [
        {
          type: 'heading_1',
          parent: '# Hello',
        },
      ];
      mockPageToMarkdown.mockResolvedValue(fakeMdBlocks);
      mockToMarkdownString.mockReturnValue({
        parent: '# Hello\n',
      });

      const result = await blocksToMd('page-123');

      expect(mockPageToMarkdown).toHaveBeenCalledWith(
        'page-123',
      );
      expect(mockToMarkdownString).toHaveBeenCalledWith(
        fakeMdBlocks,
      );
      expect(result).toBe('# Hello\n');
    });
  });
});
