import express, { Router, type NextFunction, type Request, type Response } from 'express';

import { createGroupScheduleReminderMessage } from '../messages/groupScheduleMessages.js';
import { lineClient } from '../services/lineClient.js';
import {
  claimGroupReminderDelivery,
  completeGroupReminderDelivery,
  GroupScheduleError,
  releaseGroupReminderDelivery
} from '../services/groupScheduleStore.js';
import { logger } from '../utils/logger.js';
import { reminderSecretsMatch } from './reminders.js';

const router = Router();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

router.post(
  '/',
  express.json({ limit: '8kb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!reminderSecretsMatch(req.get('X-Cafe-Reminder-Secret'))) {
      res.sendStatus(401);
      return;
    }
    const conversationId = req.body?.conversationId;
    const scheduleId = req.body?.scheduleId;
    if (
      typeof conversationId !== 'string' ||
      typeof scheduleId !== 'string' ||
      !ID_PATTERN.test(conversationId) ||
      !ID_PATTERN.test(scheduleId)
    ) {
      res.status(400).json({ error: 'Invalid group reminder payload' });
      return;
    }

    let claimed = false;
    try {
      const schedule = await claimGroupReminderDelivery(conversationId, scheduleId);
      if (!schedule) {
        res.sendStatus(204);
        return;
      }
      claimed = true;
      await lineClient.pushMessage({
        to: conversationId,
        messages: [createGroupScheduleReminderMessage(schedule)]
      });
      await completeGroupReminderDelivery(conversationId, scheduleId);
      logger.info('Group cafe reminder sent', { scheduleId });
      res.sendStatus(204);
    } catch (error) {
      if (claimed) {
        try {
          await releaseGroupReminderDelivery(conversationId, scheduleId);
        } catch (releaseError) {
          logger.error('Failed to release group reminder lease', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError)
          });
        }
      }
      if (
        error instanceof GroupScheduleError &&
        ['not_found', 'stale'].includes(error.code)
      ) {
        res.sendStatus(204);
        return;
      }
      next(error);
    }
  }
);

export default router;
