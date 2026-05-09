import express, { Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { secureCompare, sanitizeErrorMessage } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export interface SSETransportConfig {
  port: number;
  host: string;
  ssePath: string;
  heartbeatInterval: number;
  authToken?: string;
  sessionTimeout?: number;
  enableHttps?: boolean;
  httpsKeyPath?: string;
  httpsCertPath?: string;
}

// Store transports by sessionId
const transports = new Map<string, StreamableHTTPServerTransport>();

export function createSSETransport(
  server: Server,
  config: SSETransportConfig
): express.Application {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(5 * 60 * 1000);
    res.setTimeout(5 * 60 * 1000);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.apiRequest(req.method, req.path, res.statusCode, duration);
    });
    next();
  });

  // CORS
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    skip: (req) => req.path === '/health',
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many requests' });
    },
  });
  app.use(limiter);

  // Auth middleware
  if (config.authToken) {
    app.use((req, res, next) => {
      if (req.path === '/health') return next();
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token || !secureCompare(token, config.authToken!)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      transport: 'streamable-http',
    });
  });

  // MCP endpoint — Streamable HTTP (POST)
  app.post(config.ssePath, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        // Resume existing session
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session — create transport and connect server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports.set(newSessionId, transport);
            logger.info('Session initialized', { sessionId: newSessionId });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            transports.delete(sid);
            logger.info('Session closed', { sessionId: sid });
          }
        };

        await server.connect(transport);
      } else {
        res.status(400).json({
          error: 'Bad request',
          message: 'Missing mcp-session-id header or not an initialize request',
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const sanitizedMessage = sanitizeErrorMessage(error, isProduction);
      res.status(500).json({ error: 'Internal server error', message: sanitizedMessage });
    }
  });

  // GET — SSE stream for server-to-client notifications
  app.get(config.ssePath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid mcp-session-id' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // DELETE — explicit session termination
  app.delete(config.ssePath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error', { path: req.path, method: req.method }, err);
    const sanitizedMessage = sanitizeErrorMessage(err, isProduction);
    res.status(500).json({ error: 'Internal server error', message: sanitizedMessage });
  });

  return app;
}

export async function initializeSSETransport(
  server: Server,
  config: SSETransportConfig
): Promise<void> {
  const app = createSSETransport(server, config);

  return new Promise((resolve, reject) => {
    try {
      let httpServer;

      if (config.enableHttps && config.httpsKeyPath && config.httpsCertPath) {
        const options = {
          key: readFileSync(config.httpsKeyPath),
          cert: readFileSync(config.httpsCertPath),
        };
        httpServer = createHttpsServer(options, app);
        logger.info('Starting HTTPS server', { host: config.host, port: config.port });
      } else {
        httpServer = createHttpServer(app);
        logger.info('Starting HTTP server', { host: config.host, port: config.port });
      }

      httpServer.listen(config.port, config.host, () => {
        const protocol = config.enableHttps ? 'https' : 'http';
        logger.info('Hevy MCP Server started', {
          protocol,
          host: config.host,
          port: config.port,
          ssePath: config.ssePath,
        });
        console.error(`Hevy MCP Server running on ${protocol}://${config.host}:${config.port}`);
        console.error(`MCP endpoint: ${protocol}://${config.host}:${config.port}${config.ssePath}`);
        console.error(`Health check: ${protocol}://${config.host}:${config.port}/health`);
        resolve();
      });

      httpServer.on('error', (error) => {
        logger.error('Server error', {}, error);
        reject(error);
      });
    } catch (error) {
      logger.error('Failed to start server', {}, error as Error);
      reject(error);
    }
  });
}
