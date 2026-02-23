import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from '@jest/globals';

// ── Mock setup (must be before any config.js import) ────────────────────────

const mockReadFile = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('fs/promises', () => ({
  readFile: mockReadFile,
}));

// Dynamic import after mocking
let parseCliFlags: (typeof import('./config.js'))['parseCliFlags'];
let loadConfigFile: (typeof import('./config.js'))['loadConfigFile'];
let resolveConfig: (typeof import('./config.js'))['resolveConfig'];

beforeAll(async () => {
  const mod = await import('./config.js');
  parseCliFlags = mod.parseCliFlags;
  loadConfigFile = mod.loadConfigFile;
  resolveConfig = mod.resolveConfig;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── parseCliFlags tests ─────────────────────────────────────────────────────

describe('parseCliFlags', () => {
  it('extracts --api-secret value', () => {
    const result = parseCliFlags([
      '--api-secret',
      'secret_abc123',
    ]);

    expect(result.flags.apiSecret).toBe('secret_abc123');
  });

  it('extracts --port as number', () => {
    const result = parseCliFlags(['--port', '3000']);

    expect(result.flags.port).toBe(3000);
  });

  it('extracts --config path', () => {
    const result = parseCliFlags([
      '--config',
      '/tmp/my-config.json',
    ]);

    expect(result.flags.config).toBe('/tmp/my-config.json');
  });

  it('extracts --daemon flag (boolean)', () => {
    const result = parseCliFlags(['--daemon']);

    expect(result.flags.daemon).toBe(true);
  });

  it('returns empty flags and positional args when no flags given', () => {
    const result = parseCliFlags(['./notes', 'page-id-123']);

    expect(result.flags).toEqual({});
    expect(result.positional).toEqual([
      './notes',
      'page-id-123',
    ]);
  });
});

// ── loadConfigFile tests ────────────────────────────────────────────────────

describe('loadConfigFile', () => {
  it('reads valid JSON and returns parsed object', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        apiSecret: 'secret_from_file',
        port: 5000,
      }),
    );

    const result = await loadConfigFile('/tmp/config.json');

    expect(result).toEqual({
      apiSecret: 'secret_from_file',
      port: 5000,
    });
  });

  it('returns empty object for missing file (ENOENT)', async () => {
    const enoent = new Error('ENOENT: no such file');
    (enoent as NodeJS.ErrnoException).code = 'ENOENT';
    mockReadFile.mockRejectedValueOnce(enoent);

    const result = await loadConfigFile('/tmp/missing.json');

    expect(result).toEqual({});
  });

  it('throws on malformed JSON', async () => {
    mockReadFile.mockResolvedValueOnce('{ bad json !!!');

    await expect(
      loadConfigFile('/tmp/bad.json'),
    ).rejects.toThrow();
  });
});

// ── resolveConfig tests ─────────────────────────────────────────────────────

describe('resolveConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.NOTION_SYNC_API_SECRET = process.env.NOTION_SYNC_API_SECRET;
    savedEnv.NOTION_SYNC_PORT = process.env.NOTION_SYNC_PORT;
    delete process.env.NOTION_SYNC_API_SECRET;
    delete process.env.NOTION_SYNC_PORT;
    // Default: config file not found
    const enoent = new Error('ENOENT');
    (enoent as NodeJS.ErrnoException).code = 'ENOENT';
    mockReadFile.mockRejectedValue(enoent);
  });

  afterEach(() => {
    if (savedEnv.NOTION_SYNC_API_SECRET !== undefined) {
      process.env.NOTION_SYNC_API_SECRET = savedEnv.NOTION_SYNC_API_SECRET;
    } else {
      delete process.env.NOTION_SYNC_API_SECRET;
    }
    if (savedEnv.NOTION_SYNC_PORT !== undefined) {
      process.env.NOTION_SYNC_PORT = savedEnv.NOTION_SYNC_PORT;
    } else {
      delete process.env.NOTION_SYNC_PORT;
    }
  });

  it('CLI flag apiSecret overrides config file value', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        apiSecret: 'file_secret',
      }),
    );

    const config = await resolveConfig(
      {
        apiSecret: 'cli_secret',
      },
      ['./notes', 'root-page-id'],
    );

    expect(config.apiSecret).toBe('cli_secret');
  });

  it('config file overrides env var', async () => {
    process.env.NOTION_SYNC_API_SECRET = 'env_secret';
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        apiSecret: 'file_secret',
      }),
    );

    const config = await resolveConfig({}, [
      './notes',
      'root-page-id',
    ]);

    expect(config.apiSecret).toBe('file_secret');
  });

  it('port defaults to 4648 when not specified', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        apiSecret: 'secret_abc',
      }),
    );

    const config = await resolveConfig({}, [
      './notes',
      'root-page-id',
    ]);

    expect(config.port).toBe(4648);
  });

  it('throws when apiSecret missing from all sources', async () => {
    await expect(
      resolveConfig({}, ['./notes', 'root-page-id']),
    ).rejects.toThrow('apiSecret');
  });
});
