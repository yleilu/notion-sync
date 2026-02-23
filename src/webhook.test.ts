import {
  jest,
  beforeAll,
  afterAll,
  test,
  expect,
} from '@jest/globals';

import type { Server } from 'http';

let server: Server;
let baseUrl: string;
const onNotification = jest
  .fn<(pageId?: string) => Promise<void>>()
  .mockResolvedValue(undefined);

beforeAll(async () => {
  const { startWebhookServer } = await import('./webhook.js');
  server = await startWebhookServer({
    port: 0,
    onNotification,
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null
    ? addr.port
    : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

test('GET /health returns 200 with status ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    status: 'ok',
  });
});

test('POST / with verification_token returns 200 and does not call onNotification', async () => {
  onNotification.mockClear();
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      verification_token: 'secret_xxx',
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    ok: true,
  });
  expect(onNotification).not.toHaveBeenCalled();
});

test('POST / with page.content_updated calls onNotification with page id', async () => {
  onNotification.mockClear();
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'page.content_updated',
      entity: {
        id: 'page-123',
        type: 'page',
      },
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    ok: true,
  });
  // Give async onNotification time to fire
  await new Promise((r) => {
    setTimeout(r, 50);
  });
  expect(onNotification).toHaveBeenCalledWith('page-123');
});

test('GET / returns 405 method not allowed', async () => {
  const res = await fetch(baseUrl);
  expect(res.status).toBe(405);
  const body = await res.json();
  expect(body).toEqual({
    error: 'Method not allowed',
  });
});

test('concurrent webhooks — second is skipped while first is running', async () => {
  onNotification.mockClear();
  onNotification.mockImplementation(
    () => new Promise((resolve) => {
      setTimeout(resolve, 200);
    }),
  );

  const payload = JSON.stringify({
    type: 'page.content_updated',
    entity: {
      id: 'page-456',
      type: 'page',
    },
  });
  const headers = {
    'Content-Type': 'application/json',
  };

  const [res1, res2] = await Promise.all([
    fetch(baseUrl, {
      method: 'POST',
      headers,
      body: payload,
    }),
    fetch(baseUrl, {
      method: 'POST',
      headers,
      body: payload,
    }),
  ]);

  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);

  // Wait for the slow onNotification to finish
  await new Promise((r) => {
    setTimeout(r, 300);
  });

  expect(onNotification).toHaveBeenCalledTimes(1);
});

test('onNotification error does not crash server', async () => {
  onNotification.mockClear();
  onNotification.mockRejectedValueOnce(
    new Error('sync failed'),
  );

  const payload = JSON.stringify({
    type: 'page.content_updated',
    entity: {
      id: 'page-err',
      type: 'page',
    },
  });
  const headers = {
    'Content-Type': 'application/json',
  };

  const res1 = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: payload,
  });
  expect(res1.status).toBe(200);

  // Wait for error to propagate and syncing flag to reset
  await new Promise((r) => {
    setTimeout(r, 50);
  });

  // Server still works after error
  onNotification.mockResolvedValue(undefined);
  const res2 = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: payload,
  });
  expect(res2.status).toBe(200);

  await new Promise((r) => {
    setTimeout(r, 50);
  });
  expect(onNotification).toHaveBeenCalledTimes(2);
});

test('POST / with unknown event type returns 200 and does not call onNotification', async () => {
  onNotification.mockClear();
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'unknown_event',
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    ok: true,
  });

  await new Promise((r) => {
    setTimeout(r, 50);
  });
  expect(onNotification).not.toHaveBeenCalled();
});
