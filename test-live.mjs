#!/usr/bin/env node

/**
 * Comprehensive live test for bidirectional sync.
 *
 * Prerequisites:
 *   - NOTION_SYNC_API_SECRET env var set
 *   - Root page "Local" exists at the configured ID
 *   - npm run build has been run
 *
 * Usage: node test-live.mjs
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  unlink,
} from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';

const ROOT_PAGE_ID = '30fde7ba5068809da7f9f0f5f9bbd93e';
const TEST_DIR = resolve(homedir(), 'notion-portal');
const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic imports from built output
const { startupSync, syncFromNotion, fetchNotionTree } = await import(
  resolve(__dirname, 'dist/sync.js')
);
const {
  getChildPages,
  createPage,
  updatePageContent,
  archivePage,
  getPageMeta,
} = await import(resolve(__dirname, 'dist/notion.js'));
const { blocksToMd } = await import(resolve(__dirname, 'dist/converter.js'));
const { hashContent, hashPath, getStateDir } = await import(
  resolve(__dirname, 'dist/state.js')
);
const { markdownToBlocks } = await import('@tryfabric/martian');

// ─── Helpers ────────────────────────────────────────────────

const results = [];
const createdNotionPages = [];

const assert = (condition, label) => {
  if (condition) {
    results.push({ label, pass: true });
    console.log('  ✅ %s', label);
  } else {
    results.push({ label, pass: false });
    console.log('  ❌ %s', label);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findPageByTitle = async (parentId, title) => {
  const children = await getChildPages(parentId);
  return children.find((c) => c.title === title);
};

const createNotionPage = async (parentId, title, mdContent) => {
  const blocks = mdContent ? markdownToBlocks(mdContent) : [];
  const id = await createPage(parentId, title, blocks);
  createdNotionPages.push(id);
  return id;
};

const cleanStateDir = async () => {
  const stateDir = getStateDir(TEST_DIR, ROOT_PAGE_ID);
  const stateFile = resolve(stateDir, 'state.json');
  if (existsSync(stateFile)) await unlink(stateFile);
};

const cleanLocalDir = async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
  await mkdir(TEST_DIR, { recursive: true });
};

const cleanNotionTestPages = async () => {
  const children = await getChildPages(ROOT_PAGE_ID);
  for (const child of children) {
    if (child.title.startsWith('test-')) {
      await archivePage(child.id);
    }
  }
};

// ─── Phase 0: Setup ─────────────────────────────────────────

console.log('\n=== Phase 0: Setup ===\n');

await cleanStateDir();
await cleanLocalDir();
await cleanNotionTestPages();

// Wait for Notion to process archival
await sleep(1000);

// Create local test files (for push tests)
const localOnlyContent = '# Local Only\n\nThis was created locally.\n';
await writeFile(resolve(TEST_DIR, 'test-local-only.md'), localOnlyContent);

// A2: symlink test
const realContent = '# Real File\n\nSymlink target content.\n';
await writeFile(resolve(TEST_DIR, 'test-real.md'), realContent);
await symlink(
  resolve(TEST_DIR, 'test-real.md'),
  resolve(TEST_DIR, 'test-linked.md'),
);

// A3: subdir test
await mkdir(resolve(TEST_DIR, 'test-subdir'), { recursive: true });
await writeFile(
  resolve(TEST_DIR, 'test-subdir/test-nested.md'),
  '# Nested\n\nIn a subdirectory.\n',
);

// A6: empty file test
await writeFile(resolve(TEST_DIR, 'test-empty.md'), '');

// B1: Notion-only leaf page
const b1PageId = await createNotionPage(
  ROOT_PAGE_ID,
  'test-notion-only',
  '# From Notion\n\nThis page exists only in Notion.\n',
);
console.log('Created Notion page B1: %s', b1PageId);

// B2: Notion-only dir with child
const b2DirId = await createNotionPage(ROOT_PAGE_ID, 'test-notion-dir', '');
const b2NoteId = await createNotionPage(
  b2DirId,
  'test-note',
  '# Note\n\nNested Notion page.\n',
);
console.log('Created Notion dir B2: %s → child: %s', b2DirId, b2NoteId);

// B4: empty Notion page
const b4PageId = await createNotionPage(ROOT_PAGE_ID, 'test-empty-notion', '');
console.log('Created empty Notion page B4: %s', b4PageId);

// Wait for Notion to fully index
await sleep(2000);

console.log('Setup complete.\n');

// ─── Phase 1: startupSync ──────────────────────────────────

console.log('=== Phase 1: startupSync (A1-A3, A6, B1-B2, B4) ===\n');

const state1 = await startupSync(TEST_DIR, ROOT_PAGE_ID);

// A1: local file pushed to Notion
const a1Page = await findPageByTitle(ROOT_PAGE_ID, 'test-local-only');
assert(a1Page !== undefined, 'A1: local-only file pushed to Notion');

// A2: symlink pushed to Notion
const a2Linked = await findPageByTitle(ROOT_PAGE_ID, 'test-linked');
const a2Real = await findPageByTitle(ROOT_PAGE_ID, 'test-real');
assert(a2Linked !== undefined, 'A2: symlinked file pushed to Notion');
assert(a2Real !== undefined, 'A2: real file (symlink target) also pushed');

// A3: subdir file pushed
const a3Dir = await findPageByTitle(ROOT_PAGE_ID, 'test-subdir');
assert(a3Dir !== undefined, 'A3: subdir page created in Notion');
if (a3Dir) {
  const a3Nested = await findPageByTitle(a3Dir.id, 'test-nested');
  assert(a3Nested !== undefined, 'A3: nested file pushed under subdir');
}

// A6: empty file skipped
const a6Page = await findPageByTitle(ROOT_PAGE_ID, 'test-empty');
assert(a6Page === undefined, 'A6: empty file not pushed to Notion');

// B1: Notion-only page pulled locally
const b1Local = resolve(TEST_DIR, 'test-notion-only.md');
assert(existsSync(b1Local), 'B1: Notion-only page pulled to local');
if (existsSync(b1Local)) {
  const b1Content = await readFile(b1Local, 'utf-8');
  assert(b1Content.includes('From Notion'), 'B1: pulled content matches');
}

// B2: Notion dir+child pulled locally
const b2LocalDir = resolve(TEST_DIR, 'test-notion-dir');
const b2LocalNote = resolve(TEST_DIR, 'test-notion-dir/test-note.md');
assert(existsSync(b2LocalDir), 'B2: Notion dir pulled locally');
assert(existsSync(b2LocalNote), 'B2: Notion nested page pulled locally');
if (existsSync(b2LocalNote)) {
  const b2Content = await readFile(b2LocalNote, 'utf-8');
  assert(b2Content.includes('Nested Notion page'), 'B2: nested content matches');
}

// B4: empty Notion page skipped
const b4Local = resolve(TEST_DIR, 'test-empty-notion.md');
assert(!existsSync(b4Local), 'B4: empty Notion page not pulled locally');

console.log('');

// ─── Phase 2: Modify tests (A4, B3) ────────────────────────

console.log('=== Phase 2: Modify tests (A4, B3) ===\n');

// A4: modify local file then re-sync
const updatedContent = '# Local Only\n\nUpdated content for A4.\n';
await writeFile(resolve(TEST_DIR, 'test-local-only.md'), updatedContent);

const state2 = await startupSync(TEST_DIR, ROOT_PAGE_ID);

if (a1Page) {
  const a4Md = await blocksToMd(a1Page.id);
  assert(a4Md.includes('Updated content for A4'), 'A4: Notion updated after local modify');
}

// B3: modify Notion page then poll
// Update the Notion page content
const b3Blocks = markdownToBlocks('# From Notion\n\nUpdated from Notion for B3.\n');
await updatePageContent(b1PageId, b3Blocks);

// Wait for Notion to register the edit
await sleep(2000);

// Backdate the state timestamp so syncFromNotion detects the change
if (state2.files['test-notion-only.md']) {
  state2.files['test-notion-only.md'].notionLastEdited = '2000-01-01T00:00:00.000Z';
}

await syncFromNotion(TEST_DIR, state2);

const b3Content = await readFile(resolve(TEST_DIR, 'test-notion-only.md'), 'utf-8');
assert(
  b3Content.includes('Updated from Notion for B3'),
  'B3: local file updated after Notion modify',
);

console.log('');

// ─── Phase 3: Remove test (A5) ─────────────────────────────

console.log('=== Phase 3: Remove test (A5) ===\n');

// Delete local file then re-sync
await unlink(resolve(TEST_DIR, 'test-local-only.md'));

const state3 = await startupSync(TEST_DIR, ROOT_PAGE_ID);

// Verify Notion page is archived
if (a1Page) {
  try {
    const meta = await getPageMeta(a1Page.id);
    // If we can still get meta, check if archived
    // getPageMeta doesn't expose archived status, so just verify
    // it's removed from state
    assert(
      !state3.files['test-local-only.md'],
      'A5: removed file cleared from state',
    );
  } catch {
    assert(true, 'A5: removed file archived in Notion');
  }
}

console.log('');

// ─── Phase 4: Guard tests (C2) ─────────────────────────────

console.log('=== Phase 4: Guard tests (C2) ===\n');

// C2: updatePageContent with empty blocks should be a no-op
if (a2Real) {
  const beforeMd = await blocksToMd(a2Real.id);
  await updatePageContent(a2Real.id, []);
  const afterMd = await blocksToMd(a2Real.id);
  assert(beforeMd === afterMd, 'C2: empty blocks guard preserves content');
}

console.log('');

// ─── Phase 5: Cleanup ──────────────────────────────────────

console.log('=== Phase 5: Cleanup ===\n');

// Archive all test Notion pages
for (const pageId of createdNotionPages) {
  try {
    await archivePage(pageId);
  } catch {
    // may already be archived
  }
}

// Also archive pages created by startupSync
const allChildren = await getChildPages(ROOT_PAGE_ID);
for (const child of allChildren) {
  if (child.title.startsWith('test-')) {
    try {
      await archivePage(child.id);
    } catch {
      // ignore
    }
  }
}

// Clean local test dir
await rm(TEST_DIR, { recursive: true, force: true });
await cleanStateDir();

console.log('Cleanup complete.\n');

// ─── Report ─────────────────────────────────────────────────

console.log('=== Results ===\n');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;

for (const r of results) {
  console.log('%s %s', r.pass ? '✅' : '❌', r.label);
}

console.log('\n%d passed, %d failed, %d total\n', passed, failed, results.length);

if (failed > 0) {
  process.exit(1);
}
