import express, { Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync } from 'fs';
import { secureCompare, sanitizeErrorMessage } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export interface SSETransportConfig {
  port: number;
  host: string;
  ssePath: string;
  heartbeatInterval: number;
  authToken?: string;
  sessionTimeout?: number; // in milliseconds, default 30 days
  enableHttps?: boolean;
  httpsKeyPath?: string;
  httpsCertPath?: string;
}

// Store transports by sessionId for message routing
const transports = new Map<string, StreamableHTTPServerTransport>();

// Clean up expired sessions periodically
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000; // default timeout

  for (const [sessionId, transport] of transports.entries()) {
    const createdAt = Number(sessionId.split('_')[1]) || now;
    if (now - createdAt > thirtyDays) {
      void transport.close();
      transports.delete(sessionId);
      logger.sessionExpired(sessionId, 'inactivity');
    }
  }
}, 60 * 60 * 1000); // Check every hour
sessionCleanupTimer.unref();

type ServerFactory = () => Server;

/**
 * Initialize SSE transport for Poke.com
 * This transport uses Server-Sent Events for real-time communication
 */
export function createSSETransport(
  createServer: ServerFactory,
  config: SSETransportConfig
): express.Application {
  const app = express();
  app.set('trust proxy', 1);
  const isProduction = process.env.NODE_ENV === 'production';

  // Security headers with Helmet
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
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  // Enable JSON body parsing with size limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request timeout middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Set timeout for all requests (5 minutes for long-running AI operations)
    req.setTimeout(5 * 60 * 1000);
    res.setTimeout(5 * 60 * 1000);
    next();
  });

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.apiRequest(req.method, req.path, res.statusCode, duration);
    });

    next();
  });

  // CORS headers for remote access
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Rate limiting (skip health check for Railway and monitoring)
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Generous limit for AI agents (1000 requests per 15 min)
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health', // Exempt health check from rate limiting
    handler: (req, res) => {
      logger.rateLimitExceeded(req.ip, req.path);
      res.status(429).json({
        error: 'Too many requests',
        message: 'Please try again later',
      });
    },
  });

  // Apply rate limiting to all routes (except health check)
  app.use(limiter);

  // Stricter rate limiting for authentication
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50, // 50 auth attempts per 15 minutes
    skipSuccessfulRequests: true,
  });

  // Authentication middleware with constant-time comparison
  if (config.authToken) {
    app.use((req, res, next) => {
      // Skip auth for health check
      if (req.path === '/health') {
        return next();
      }

      // Apply auth rate limiting
      authLimiter(req, res, () => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.replace('Bearer ', '');

        if (!token || !secureCompare(token, config.authToken!)) {
          logger.authFailure('invalid_token', req.ip);
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        logger.authAttempt(true, req.ip, req.headers['mcp-session-id'] as string);
        next();
      });
    });
  }

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      transport: 'sse',
    });
  });

  app.head(config.ssePath, (_req: Request, res: Response) => {
    res.status(200).end();
  });

  // Streamable HTTP endpoint for remote MCP clients.
  app.all(config.ssePath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (req.method === 'POST') {
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (sessionId && !transport) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session not found. Start a new MCP session.' },
            id: null,
          });
          return;
        }

        if (!transport && !sessionId && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => generateSessionId(),
            onsessioninitialized: (id) => {
              transports.set(id, transport!);
              logger.sessionCreated(id, req.ip);
              logger.info('Transport stored for session', { sessionId: id });
            },
            onsessionclosed: (id) => {
              transports.delete(id);
              logger.info('Session closed', { sessionId: id });
            },
          });

          transport.onclose = () => {
            const id = transport?.sessionId;
            if (id) {
              transports.delete(id);
            }
          };

          // MCP Server owns client-specific capabilities and request routing.
          // Reusing one Server across transports lets a newer session replace
          // callbacks for an older one, leaving older tool calls hung forever.
          const sessionServer = createServer();
          await sessionServer.connect(transport);
        } else if (!transport) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID or initialization request provided.',
            },
            id: null,
          });
          return;
        }

        logger.info('Handling MCP POST message', { sessionId: sessionId || 'new' });
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'GET') {
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Missing or invalid session ID for MCP stream.' },
            id: null,
          });
          return;
        }

        logger.info('SSE stream opened for MCP session', { sessionId });
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'DELETE') {
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session not found.' },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res);
        return;
      }

      res.status(405).end();
    } catch (error) {
      logger.error('Error handling MCP request', { path: req.path, method: req.method }, error as Error);

      const sanitizedMessage = sanitizeErrorMessage(error, isProduction);

      if (!res.headersSent && !res.writableEnded) {
        res.status(500).json({
          error: 'Internal server error',
          message: sanitizedMessage,
        });
      }
    }
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error', { path: req.path, method: req.method }, err);

    const sanitizedMessage = sanitizeErrorMessage(err, isProduction);

    res.status(500).json({
      error: 'Internal server error',
      message: sanitizedMessage,
    });
  });

  return app;
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Start the SSE server with optional HTTPS support
 */
export async function initializeSSETransport(
  createServer: ServerFactory,
  config: SSETransportConfig
): Promise<void> {
  const app = createSSETransport(createServer, config);

  return new Promise((resolve, reject) => {
    try {
      let httpServer;

      if (config.enableHttps && config.httpsKeyPath && config.httpsCertPath) {
        // HTTPS server
        const options = {
          key: readFileSync(config.httpsKeyPath),
          cert: readFileSync(config.httpsCertPath),
        };

        httpServer = createHttpsServer(options, app);
        logger.info('Starting HTTPS server', {
          host: config.host,
          port: config.port
        });
      } else {
        // HTTP server
        httpServer = createHttpServer(app);
        logger.info('Starting HTTP server', {
          host: config.host,
          port: config.port
        });

        if (process.env.NODE_ENV === 'production') {
          logger.warn('Running without HTTPS in production - not recommended!');
        }
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
        console.error(`SSE endpoint: ${protocol}://${config.host}:${config.port}${config.ssePath}`);
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
