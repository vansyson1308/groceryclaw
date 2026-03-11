import { createServer } from 'node:http';

export function startWorkerHealthServer(opts: {
  readonly host: string;
  readonly port: number;
  readonly isReady: () => Promise<boolean>;
}) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }

    if (req.url === '/readyz') {
      const ready = await opts.isReady();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ok' : 'not_ready', service: 'worker' }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(opts.port, opts.host);
  return server;
}
