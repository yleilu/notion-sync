// ── Types ────────────────────────────────────────────────────────────────────

export interface DiffKeep {
  type: 'keep'
  blockId: string
}
export interface DiffInsert {
  type: 'insert'
  afterBlockId: string | null
  newBlock: unknown
}
export interface DiffDelete {
  type: 'delete'
  blockId: string
}
export interface DiffUpdate {
  type: 'update'
  blockId: string
  newBlock: unknown
}
export type DiffOp =
  | DiffKeep
  | DiffInsert
  | DiffDelete
  | DiffUpdate

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RichTextItem {
  plain_text?: string
  text?: { content?: string }
}

interface BlockLike {
  id?: string
  type?: string
  [key: string]: unknown
}

export const extractPlainText = (
  richText: unknown[],
): string => {
  if (!Array.isArray(richText)) return '';
  return richText
    .map((item) => {
      const rt = item as RichTextItem;
      if (rt.plain_text !== undefined) return rt.plain_text;
      if (rt.text && rt.text.content !== undefined) return rt.text.content;
      return '';
    })
    .join('');
};

export const getBlockContent = (
  block: unknown,
): { type: string; text: string } => {
  const b = block as BlockLike;
  const type = b.type || '';
  const body = b[type] as
    | { rich_text?: unknown[] }
    | undefined;
  const text = body && Array.isArray(body.rich_text)
    ? extractPlainText(body.rich_text)
    : '';
  return {
    type,
    text,
  };
};

export const blocksMatch = (
  oldBlock: unknown,
  newBlock: unknown,
): boolean => {
  const a = getBlockContent(oldBlock);
  const b = getBlockContent(newBlock);
  return a.type === b.type && a.text === b.text;
};

// ── LCS Diff ────────────────────────────────────────────────────────────────

export const diffBlocks = (
  oldBlocks: unknown[],
  newBlocks: unknown[],
): DiffOp[] => {
  const m = oldBlocks.length;
  const n = newBlocks.length;

  // Build LCS table
  const dp: number[][] = Array.from(
    {
      length: m + 1,
    },
    () => Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (blocksMatch(oldBlocks[i - 1], newBlocks[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce ops
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  // Collect ops in reverse, then reverse at the end
  const reversed: DiffOp[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && blocksMatch(oldBlocks[i - 1], newBlocks[j - 1])) {
      reversed.push({
        type: 'keep',
        blockId: (oldBlocks[i - 1] as BlockLike).id || '',
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // New block not in old → insert
      reversed.push({
        type: 'insert',
        afterBlockId: '', // placeholder, resolved below
        newBlock: newBlocks[j - 1],
      });
      j -= 1;
    } else {
      // Old block not in new → delete
      reversed.push({
        type: 'delete',
        blockId: (oldBlocks[i - 1] as BlockLike).id || '',
      });
      i -= 1;
    }
  }

  reversed.reverse();

  // Merge delete+insert of same type into update (patch in place).
  // Then resolve afterBlockId for remaining inserts.
  const merged: DiffOp[] = [];
  for (let k = 0; k < reversed.length; k += 1) {
    const curr = reversed[k];
    const next = reversed[k + 1];
    if (
      curr.type === 'delete'
      && next
      && next.type === 'insert'
      && getBlockContent(
        oldBlocks.find(
          (b) => (b as BlockLike).id === curr.blockId,
        ),
      ).type === getBlockContent(next.newBlock).type
    ) {
      merged.push({
        type: 'update',
        blockId: curr.blockId,
        newBlock: next.newBlock,
      });
      k += 1; // skip the insert
    } else {
      merged.push(curr);
    }
  }

  // Resolve afterBlockId for inserts
  let lastOldBlockId: string | null = null;

  for (const op of merged) {
    if (op.type === 'keep' || op.type === 'update') {
      lastOldBlockId = op.blockId;
      ops.push(op);
    } else if (op.type === 'delete') {
      ops.push(op);
    } else if (op.type === 'insert') {
      ops.push({
        type: 'insert',
        afterBlockId: lastOldBlockId,
        newBlock: op.newBlock,
      });
    }
  }

  return ops;
};
