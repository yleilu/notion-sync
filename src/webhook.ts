import { createServer } from 'http';

import type {
  Server,
  IncomingMessage,
  ServerResponse,
} from 'http';

interface WebhookOptions {
  port: number
  onNotification: (pageId?: string) => Promise<void>
}

const json = (
  res: ServerResponse,
  status: number,
  data: unknown,
): void => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(data));
};

const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    resolve(Buffer.concat(chunks).toString());
  });
  req.on('error', reject);
});

export const startWebhookServer = (
  options: WebhookOptions,
): Promise<Server> => {
  const { port, onNotification } = options;
  let syncing = false;

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const { method, url } = req;

      if (method === 'GET' && url === '/health') {
        json(res, 200, {
          status: 'ok',
        });
        return;
      }

      if (method !== 'POST' || url !== '/') {
        json(res, 405, {
          error: 'Method not allowed',
        });
        return;
      }

      let body: Record<string, unknown>;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        json(res, 400, {
          error: 'Invalid JSON',
        });
        return;
      }

      // Verification handshake — respond but do not trigger sync
      if (body.verification_token) {
        json(res, 200, {
          ok: true,
        });
        return;
      }

      // Respond immediately for all event types
      json(res, 200, {
        ok: true,
      });

      // Only handle page content updates
      if (body.type !== 'page.content_updated') {
        return;
      }

      // Dedup — skip if already syncing
      if (syncing) {
        return;
      }

      syncing = true;
      const entity = body.entity as
        | { id?: string; type?: string }
        | null
        | undefined;
      const pageId = entity !== null && entity !== undefined
        ? entity.id
        : undefined;

      try {
        await onNotification(pageId);
      } catch (err) {
        console.error('webhook onNotification error:', err);
      } finally {
        syncing = false;
      }
    },
  );

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr !== null
        ? addr.port
        : port;
      console.log(
        `webhook server listening on port ${actualPort}`,
      );
      resolve(server);
    });
  });
};
