#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, openSync } from 'fs';
import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';

import {
  writePid,
  readPid,
  cleanPid,
  saveState,
  hashPath,
  getStateDir,
  readPidById,
  cleanPidById,
  listDaemons,
} from './state.js';
import { startupSync, syncFromNotion } from './sync.js';
import { startWatcher } from './watcher.js';
import { parseCliFlags, resolveConfig } from './config.js';
import { setApiSecret } from './notion.js';
import { startWebhookServer } from './webhook.js';

import type { SyncState } from './state.js';
import type { Server } from 'http';

let flags: ReturnType<typeof parseCliFlags>['flags'];

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
  const config = await resolveConfig(flags, [
    dirPath,
    pageId,
  ]);
  setApiSecret(config.apiSecret);

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
  const server: Server = await startWebhookServer({
    port: config.port,
    onNotification: () => syncFromNotion(dirPath, state),
  });

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    server.close();
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

  const id = hashPath(dirPath);

  const existingPid = await readPid(dirPath);
  if (existingPid !== null) {
    try {
      process.kill(existingPid, 0);
      console.error(
        'Daemon already running (PID %d). Use "notion-sync stop %s" first.',
        existingPid,
        id,
      );
      process.exit(1);
    } catch {
      await cleanPid(dirPath);
    }
  }

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
      ...(flags.apiSecret
        ? ['--api-secret', flags.apiSecret]
        : []),
      ...(flags.port ? ['--port', String(flags.port)] : []),
      ...(flags.config ? ['--config', flags.config] : []),
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

const parsed = parseCliFlags(process.argv.slice(2));
flags = parsed.flags;
const { positional } = parsed;

const run = async (): Promise<void> => {
  if (positional[0] === 'list') {
    await list();
  } else if (positional[0] === 'stop') {
    if (!positional[1]) {
      console.error('Usage: notion-sync stop <id>');
      process.exit(1);
    }
    await stop(positional[1]);
  } else if (positional.length >= 2) {
    if (flags.daemon) {
      await daemonChild(
        resolve(positional[0]),
        positional[1],
      );
    } else {
      await start(positional[0], positional[1]);
    }
  } else {
    console.error(
      'Usage: notion-sync <path-to-dir> <page-id> [--api-secret <secret>] [--port <port>] [--config <path>]',
    );
    console.error('       notion-sync list');
    console.error('       notion-sync stop <id>');
    process.exit(1);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
