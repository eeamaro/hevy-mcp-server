import { createServer as createHttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createHevyMCPServer } from '../dist/server.js';
import { createSSETransport } from '../dist/transports/sse.js';

const app = createSSETransport(
  () =>
    createHevyMCPServer({
      apiKey: 'transport-test-key',
      apiBaseUrl: 'http://127.0.0.1:1',
    }),
  {
    port: 0,
    host: '127.0.0.1',
    ssePath: '/mcp',
    heartbeatInterval: 30_000,
  }
);

const httpServer = createHttpServer(app);
await new Promise((resolve, reject) => {
  httpServer.once('error', reject);
  httpServer.listen(0, '127.0.0.1', resolve);
});

const address = httpServer.address();
if (!address || typeof address === 'string') {
  throw new Error('Could not determine test server port');
}

const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
const clients = [];

async function connectClient(name) {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint);
  await client.connect(transport);
  clients.push(client);
  return client;
}

try {
  const first = await connectClient('transport-test-first');
  const firstBefore = await first.listTools();
  const second = await connectClient('transport-test-second');
  const secondResult = await second.listTools();
  const firstAfter = await first.listTools();

  for (const [label, result] of [
    ['first-before', firstBefore],
    ['second', secondResult],
    ['first-after', firstAfter],
  ]) {
    if (!result.tools.some((tool) => tool.name === 'get-routines')) {
      throw new Error(`${label} session did not receive the Hevy tool registry`);
    }
  }

  const [firstConcurrent, secondConcurrent] = await Promise.all([
    first.listTools(),
    second.listTools(),
  ]);
  if (firstConcurrent.tools.length !== secondConcurrent.tools.length) {
    throw new Error('Concurrent sessions returned different tool registries');
  }

  console.log(
    `PASS streamable HTTP session isolation (${firstConcurrent.tools.length} tools per client)`
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  await new Promise((resolve) => httpServer.close(resolve));
}
