#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, openSync } from 'fs';
import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';

import {
  writePid,
  cleanPid,
  saveState,
  hashPath,
  getStateDir,
  readPidById,
  cleanPidById,
  listDaemons,
} from './state.js';
import { startupSync } from './sync.js';
import { startWatcher } from './watcher.js';
import { startPoller } from './poller.js';

import type { SyncState } from './state.js';

const list = async (): Promise<void> => {
  const daemons = await listDaemons();
  if (daemons.length === 0) {
    console.log('No running daemons');
    return;
  }
  for (const d of daemons) {
    console.log(
      '%s  pid=%d  %s → %s',
      d.id,
      d.pid,
      d.dirPath,
      d.rootPageId,
    );
  }
};

const stop = async (id: string): Promise<void> => {
  const pid = await readPidById(id);

  if (pid === null) {
    console.error('No daemon found for id %s', id);
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log('Sent SIGTERM to daemon (PID %d)', pid);

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
    await cleanPidById(id);
    console.log('Daemon stopped');
  } catch (err) {
    console.error(
      'Failed to stop daemon (PID %d):',
      pid,
      err,
    );
    await cleanPidById(id);
  }
};

const daemonChild = async (
  dirPath: string,
  pageId: string,
): Promise<void> => {
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

  const id = hashPath(dirPath);
  const stateDir = getStateDir(dirPath);
  await mkdir(stateDir, {
    recursive: true,
  });

  const logPath = resolve(stateDir, 'daemon.log');
  const logFd = openSync(logPath, 'a');

  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      dirArg,
      pageId,
      '--daemon',
    ],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    },
  );

  child.unref();

  console.log(
    'Started notion-sync [%s] (PID %d)',
    id,
    child.pid,
  );
  console.log('Log: %s', logPath);
};

const args = process.argv.slice(2);
const isDaemon = args.includes('--daemon');
const positional = args.filter((a) => a !== '--daemon');

if (positional.at(0) === 'list') {
  list();
} else if (positional.at(0) === 'stop') {
  if (!positional.at(1)) {
    console.error('Usage: notion-sync stop <id>');
    process.exit(1);
  }
  stop(positional.at(1)!);
} else if (positional.length >= 2) {
  if (isDaemon) {
    daemonChild(
      resolve(positional.at(0)!),
      positional.at(1)!,
    );
  } else {
    start(positional.at(0)!, positional.at(1)!);
  }
} else {
  console.error(
    'Usage: notion-sync <path-to-dir> <page-id>',
  );
  console.error('       notion-sync list');
  console.error('       notion-sync stop <id>');
  process.exit(1);
}
