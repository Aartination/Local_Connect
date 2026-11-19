import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { CLIENT_DIST, config } from './config.js';
import { logger } from './logger.js';
import { apiLimiter, originGuard } from './middleware/security.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { conversationsRouter } from './routes/conversations.js';
import { filesRouter } from './routes/files.js';
import { messagesRouter } from './routes/messages.js';
import { systemRouter } from './routes/system.js';
import { usersRouter } from './routes/users.js';
import { workspaceRouter } from './routes/workspace.js';
import { HttpError } from './utils/http.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:', 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'frame-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );

  // API middleware
  app.use('/api', apiLimiter);
  app.use('/api', originGuard);
  app.use('/api', express.json({ limit: '2mb' }));

  // Routes
  app.use('/api/system', systemRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/workspace', workspaceRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
  });

  // Serve built React frontend in production
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(
      '/assets',
      express.static(path.join(CLIENT_DIST, 'assets'), {
        maxAge: '365d',
        immutable: true,
      }),
    );
    app.use(
      express.static(CLIENT_DIST, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      }),
    );
    // SPA fallback for client-side routes
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  } else if (!config.isDev) {
    app.get('/', (_req, res) => {
      res.status(503).send('LOCAL HUB frontend has not been built yet. Run "npm run build" or install.bat.');
    });
  }

  // Centralized error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code || 'ERROR',
        ...(err.details ? { details: err.details } : {}),
      });
    }
    if ((err as any)?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload is too large.', code: 'PAYLOAD_TOO_LARGE' });
    }
    if ((err as any)?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body.', code: 'BAD_JSON' });
    }
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  });

  return app;
}

