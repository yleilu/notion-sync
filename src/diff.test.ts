import { describe, it, expect } from '@jest/globals';

import {
  extractPlainText,
  getBlockContent,
  blocksMatch,
  diffBlocks,
} from './diff.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const p = (text: string, id?: string) => ({
  ...(id
    ? {
      id,
    }
    : {}),
  type: 'paragraph',
  paragraph: {
    rich_text: [
      {
        text: {
          content: text,
        },
      },
    ],
  },
});

const pResponse = (text: string, id: string) => ({
  id,
  type: 'paragraph',
  paragraph: {
    rich_text: [
      {
        plain_text: text,
      },
    ],
  },
});

const h1 = (text: string, id?: string) => ({
  ...(id
    ? {
      id,
    }
    : {}),
  type: 'heading_1',
  heading_1: {
    rich_text: [
      {
        text: {
          content: text,
        },
      },
    ],
  },
});

// ── extractPlainText ─────────────────────────────────────────────────────────

describe('extractPlainText', () => {
  it('extracts from response format (plain_text field)', () => {
    const items = [
      {
        plain_text: 'hello ',
      },
      {
        plain_text: 'world',
      },
    ];
    expect(extractPlainText(items)).toBe('hello world');
  });

  it('extracts from request format (text.content field)', () => {
    const items = [
      {
        text: {
          content: 'foo ',
        },
      },
      {
        text: {
          content: 'bar',
        },
      },
    ];
    expect(extractPlainText(items)).toBe('foo bar');
  });

  it('returns empty string for empty array', () => {
    expect(extractPlainText([])).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(
      extractPlainText(undefined as unknown as unknown[]),
    ).toBe('');
  });
});

// ── getBlockContent ──────────────────────────────────────────────────────────

describe('getBlockContent', () => {
  it('extracts type and text from request-format block', () => {
    expect(getBlockContent(p('hello'))).toEqual({
      type: 'paragraph',
      text: 'hello',
    });
  });

  it('extracts type and text from response-format block', () => {
    expect(
      getBlockContent(pResponse('hello', 'b1')),
    ).toEqual({
      type: 'paragraph',
      text: 'hello',
    });
  });

  it('extracts from heading blocks', () => {
    expect(getBlockContent(h1('title'))).toEqual({
      type: 'heading_1',
      text: 'title',
    });
  });

  it('returns empty text for blocks without rich_text', () => {
    const block = {
      type: 'divider',
      divider: {},
    };
    expect(getBlockContent(block)).toEqual({
      type: 'divider',
      text: '',
    });
  });
});

// ── blocksMatch ──────────────────────────────────────────────────────────────

describe('blocksMatch', () => {
  it('returns true for same type and same text', () => {
    expect(
      blocksMatch(pResponse('hello', 'b1'), p('hello')),
    ).toBe(true);
  });

  it('returns false for different type', () => {
    expect(
      blocksMatch(pResponse('hello', 'b1'), h1('hello')),
    ).toBe(false);
  });

  it('returns false for same type but different text', () => {
    expect(
      blocksMatch(pResponse('old', 'b1'), p('new')),
    ).toBe(false);
  });

  it('returns true for both empty paragraphs', () => {
    const emptyOld = {
      id: 'b1',
      type: 'paragraph',
      paragraph: {
        rich_text: [],
      },
    };
    const emptyNew = {
      type: 'paragraph',
      paragraph: {
        rich_text: [],
      },
    };
    expect(blocksMatch(emptyOld, emptyNew)).toBe(true);
  });
});

// ── diffBlocks (LCS-based) ──────────────────────────────────────────────────

describe('diffBlocks', () => {
  it('keeps identical blocks', () => {
    const old = [pResponse('hello', 'b1')];
    const ops = diffBlocks(old, [p('hello')]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
    ]);
  });

  it('inserts block in the middle', () => {
    const old = [
      pResponse('a', 'b1'),
      pResponse('b', 'b2'),
      pResponse('c', 'b3'),
    ];
    const inserted = p('X');
    const ops = diffBlocks(old, [
      p('a'),
      inserted,
      p('b'),
      p('c'),
    ]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'insert',
        afterBlockId: 'b1',
        newBlock: inserted,
      },
      {
        type: 'keep',
        blockId: 'b2',
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
    ]);
  });

  it('inserts block at start', () => {
    const old = [pResponse('a', 'b1'), pResponse('b', 'b2')];
    const inserted = p('X');
    const ops = diffBlocks(old, [inserted, p('a'), p('b')]);

    expect(ops).toEqual([
      {
        type: 'insert',
        afterBlockId: null,
        newBlock: inserted,
      },
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'keep',
        blockId: 'b2',
      },
    ]);
  });

  it('inserts block at end', () => {
    const old = [pResponse('a', 'b1')];
    const inserted = p('X');
    const ops = diffBlocks(old, [p('a'), inserted]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'insert',
        afterBlockId: 'b1',
        newBlock: inserted,
      },
    ]);
  });

  it('deletes block from middle', () => {
    const old = [
      pResponse('a', 'b1'),
      pResponse('b', 'b2'),
      pResponse('c', 'b3'),
    ];
    const ops = diffBlocks(old, [p('a'), p('c')]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'delete',
        blockId: 'b2',
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
    ]);
  });

  it('deletes block from start', () => {
    const old = [
      pResponse('a', 'b1'),
      pResponse('b', 'b2'),
      pResponse('c', 'b3'),
    ];
    const ops = diffBlocks(old, [p('b'), p('c')]);

    expect(ops).toEqual([
      {
        type: 'delete',
        blockId: 'b1',
      },
      {
        type: 'keep',
        blockId: 'b2',
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
    ]);
  });

  it('updates block with different text (same type → update)', () => {
    const old = [pResponse('old', 'b1')];
    const newBlock = p('new');
    const ops = diffBlocks(old, [newBlock]);

    expect(ops).toEqual([
      {
        type: 'update',
        blockId: 'b1',
        newBlock,
      },
    ]);
  });

  it('handles type change (delete + insert)', () => {
    const old = [pResponse('hello', 'b1')];
    const newBlock = h1('hello');
    const ops = diffBlocks(old, [newBlock]);

    expect(ops).toEqual([
      {
        type: 'delete',
        blockId: 'b1',
      },
      {
        type: 'insert',
        afterBlockId: null,
        newBlock,
      },
    ]);
  });

  it('appends all when old is empty', () => {
    const newP = p('a');
    const ops = diffBlocks([], [newP]);

    expect(ops).toEqual([
      {
        type: 'insert',
        afterBlockId: null,
        newBlock: newP,
      },
    ]);
  });

  it('deletes all when new is empty', () => {
    const old = [pResponse('a', 'b1')];
    const ops = diffBlocks(old, []);

    expect(ops).toEqual([
      {
        type: 'delete',
        blockId: 'b1',
      },
    ]);
  });

  it('inserts multiple blocks at same position', () => {
    const old = [pResponse('a', 'b1'), pResponse('c', 'b3')];
    const x = p('X');
    const y = p('Y');
    const ops = diffBlocks(old, [p('a'), x, y, p('c')]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'insert',
        afterBlockId: 'b1',
        newBlock: x,
      },
      {
        type: 'insert',
        afterBlockId: 'b1',
        newBlock: y,
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
    ]);
  });

  it('handles mixed update and delete', () => {
    const old = [
      pResponse('a', 'b1'),
      pResponse('b', 'b2'),
      pResponse('c', 'b3'),
      pResponse('d', 'b4'),
    ];
    const e = p('E');
    const ops = diffBlocks(old, [p('a'), e, p('c')]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'update',
        blockId: 'b2',
        newBlock: e,
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
      {
        type: 'delete',
        blockId: 'b4',
      },
    ]);
  });

  it('matches blocks with full Notion response vs martian request formats', () => {
    const notionResponse = (text: string, id: string) => ({
      object: 'block',
      id,
      parent: {
        type: 'page_id',
        page_id: 'page-1',
      },
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: text,
              link: null,
            },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            plain_text: text,
            href: null,
          },
        ],
        color: 'default',
      },
    });

    const martianBlock = (text: string) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            annotations: {
              bold: false,
              strikethrough: false,
              underline: false,
              italic: false,
              code: false,
              color: 'default',
            },
            text: {
              content: text,
            },
          },
        ],
      },
    });

    const old = [
      notionResponse('Line one', 'b1'),
      notionResponse('Line two', 'b2'),
      notionResponse('Line three', 'b3'),
    ];
    const inserted = martianBlock('Inserted line');
    const ops = diffBlocks(old, [
      martianBlock('Line one'),
      martianBlock('Line two'),
      inserted,
      martianBlock('Line three'),
    ]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'keep',
        blockId: 'b2',
      },
      {
        type: 'insert',
        afterBlockId: 'b2',
        newBlock: inserted,
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
    ]);
  });

  it('keeps all blocks when content unchanged (full Notion formats)', () => {
    const notionResponse = (text: string, id: string) => ({
      object: 'block',
      id,
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: text,
              link: null,
            },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
            plain_text: text,
            href: null,
          },
        ],
        color: 'default',
      },
    });

    const martianBlock = (text: string) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            annotations: {
              bold: false,
              strikethrough: false,
              underline: false,
              italic: false,
              code: false,
              color: 'default',
            },
            text: {
              content: text,
            },
          },
        ],
      },
    });

    const old = [
      notionResponse('A', 'b1'),
      notionResponse('B', 'b2'),
      notionResponse('C', 'b3'),
    ];
    const ops = diffBlocks(old, [
      martianBlock('A'),
      martianBlock('B'),
      martianBlock('C'),
    ]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'keep',
        blockId: 'b2',
      },
      {
        type: 'keep',
        blockId: 'b3',
      },
    ]);
  });

  it('handles type mismatch via delete + insert', () => {
    const old = [pResponse('a', 'b1'), pResponse('b', 'b2')];
    const newH1 = h1('a');
    const newP = p('c');
    const ops = diffBlocks(old, [newH1, newP]);

    expect(ops).toEqual([
      {
        type: 'delete',
        blockId: 'b1',
      },
      {
        type: 'delete',
        blockId: 'b2',
      },
      {
        type: 'insert',
        afterBlockId: null,
        newBlock: newH1,
      },
      {
        type: 'insert',
        afterBlockId: null,
        newBlock: newP,
      },
    ]);
  });

  it('deletes extra old blocks when new is shorter', () => {
    const old = [
      pResponse('a', 'b1'),
      pResponse('b', 'b2'),
      pResponse('c', 'b3'),
    ];
    const ops = diffBlocks(old, [p('a')]);

    expect(ops).toEqual([
      {
        type: 'keep',
        blockId: 'b1',
      },
      {
        type: 'delete',
        blockId: 'b2',
      },
      {
        type: 'delete',
        blockId: 'b3',
      },
    ]);
  });
});
