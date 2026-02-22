#!/usr/bin/env node

import { resolve } from 'path';
import { existsSync } from 'fs';

import {
  writePid,
  readPid,
  cleanPid,
  saveState,
} from './state.js';
import { startupSync } from './sync.js';
import { startWatcher } from './watcher.js';
import { startPoller } from './poller.js';

import type { SyncState } from './state.js';

const stop = async (dirArg: string): Promise<void> => {
  const dirPath = resolve(dirArg);
  const pid = await readPid(dirPath);

  if (pid === null) {
    console.error('No running daemon found for %s', dirPath);
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log('Sent SIGTERM to daemon (PID %d)', pid);

    // Wait for process to exit, then clean PID
    const deadline = Date.now() + 5e3;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => {
          setTimeout(r, 2e2);
        });
      } catch {
        break;
      }
    }
    await cleanPid(dirPath);
    console.log('Daemon stopped');
  } catch (err) {
    console.error(
      'Failed to stop daemon (PID %d):',
      pid,
      err,
    );
    await cleanPid(dirPath);
  }
};

const start = async (
  dirArg: string,
  pageId: string,
): Promise<void> => {
  const dirPath = resolve(dirArg);

  if (!existsSync(dirPath)) {
    console.error('Directory does not exist: %s', dirPath);
    process.exit(1);
  }

  if (!process.env.NOTION_SYNC_API_SECRET) {
    console.error('Missing NOTION_SYNC_API_SECRET env var');
    process.exit(1);
  }

  console.log(
    'Starting notion-sync for %s → %s',
    dirPath,
    pageId,
  );
  await writePid(dirPath);

  let state: SyncState;
  try {
    state = await startupSync(dirPath, pageId);
  } catch (err) {
    console.error('Startup sync failed:', err);
    await cleanPid(dirPath);
    process.exit(1);
  }

  console.log('Startup sync complete');

  const watcher = startWatcher(dirPath, state);
  const poller = startPoller(dirPath, state);

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    clearInterval(poller);
    await watcher.close();
    await saveState(resolve(dirPath), state);
    await cleanPid(dirPath);
    console.log('Saved state and exited');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

const args = process.argv.slice(2);

if (args.at(0) === 'stop') {
  if (!args.at(1)) {
    console.error('Usage: notion-sync stop <path-to-dir>');
    process.exit(1);
  }
  stop(args.at(1)!);
} else if (args.length >= 2) {
  start(args.at(0)!, args.at(1)!);
} else {
  console.error(
    'Usage: notion-sync <path-to-dir> <page-id>',
  );
  console.error('       notion-sync stop <path-to-dir>');
  process.exit(1);
}
