import express, { type NextFunction, type Request, type Response } from 'express';

import reminderRouter from './routes/reminders.js';
import groupReminderRouter from './routes/groupReminders.js';
import webhookRouter from './routes/webhook.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      name: 'line-cafe-group-scheduler',
      status: 'ok',
      webhook: '/webhook',
      reminderTask: '/tasks/visit-reminders',
      groupReminderTask: '/tasks/group-reminders'
    });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/webhook', webhookRouter);
  app.use('/tasks/visit-reminders', reminderRouter);
  app.use('/tasks/group-reminders', groupReminderRouter);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal Server Error';

    logger.error('Unhandled request error', { message });
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

export const app = createApp();
