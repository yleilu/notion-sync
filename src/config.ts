import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { homedir } from 'os';

export interface CliFlags {
  apiSecret?: string
  port?: number
  config?: string
  daemon?: boolean
  name?: string
}

export interface ConfigFile {
  apiSecret?: string
  port?: number
}

export interface NotionSyncConfig {
  apiSecret: string
  port: number
  dirPath: string
  rootPageId: string
  name?: string
}

const DEFAULT_CONFIG_PATH = resolve(
  homedir(),
  '.notion-sync',
  'config.json',
);
const DEFAULT_PORT = 4648;

export const parseCliFlags = (
  argv: string[],
): { flags: CliFlags; positional: string[] } => {
  const flags: CliFlags = {};
  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--api-secret') {
      i += 1;
      flags.apiSecret = argv[i];
    } else if (arg === '--port') {
      i += 1;
      flags.port = Number(argv[i]);
    } else if (arg === '--config') {
      i += 1;
      flags.config = argv[i];
    } else if (arg === '--daemon') {
      flags.daemon = true;
    } else if (arg === '--name') {
      i += 1;
      flags.name = argv[i];
    } else {
      positional.push(arg);
    }

    i += 1;
  }

  return {
    flags,
    positional,
  };
};

export const loadConfigFile = async (
  configPath: string,
): Promise<ConfigFile> => {
  let raw: string;

  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err
      ? (err as { code: string }).code
      : null;
    if (code === 'ENOENT') return {};
    throw err;
  }

  return JSON.parse(raw) as ConfigFile;
};

export const resolveConfig = async (
  flags: CliFlags,
  positional: string[],
): Promise<NotionSyncConfig> => {
  const configPath = flags.config
    ? flags.config
    : DEFAULT_CONFIG_PATH;

  const file = await loadConfigFile(configPath);

  let apiSecret: string | null = null;
  if (flags.apiSecret !== undefined) {
    apiSecret = flags.apiSecret;
  } else if (file.apiSecret !== undefined) {
    apiSecret = file.apiSecret;
  } else if (process.env.NOTION_SYNC_API_SECRET) {
    apiSecret = process.env.NOTION_SYNC_API_SECRET;
  }

  if (apiSecret === null) {
    throw new Error(
      'apiSecret is required: pass --api-secret, set NOTION_SYNC_API_SECRET, or add to config file',
    );
  }

  let port = DEFAULT_PORT;
  if (flags.port !== undefined) {
    port = flags.port;
  } else if (file.port !== undefined) {
    port = file.port;
  } else if (process.env.NOTION_SYNC_PORT) {
    port = Number(process.env.NOTION_SYNC_PORT);
  }

  const dirPath = positional[0]
    ? resolve(positional[0])
    : resolve('.');

  const rootPageId = positional[1] ? positional[1] : '';

  return {
    apiSecret,
    port,
    dirPath,
    rootPageId,
    ...(flags.name
      ? {
        name: flags.name,
      }
      : {}),
  };
};
