import { CloudTasksClient, protos } from '@google-cloud/tasks';

import { env } from '../utils/env.js';
import {
  attachGroupReminder,
  confirmedGroupScheduleOption,
  type GroupSchedule
} from './groupScheduleStore.js';

const tasksClient = new CloudTasksClient();

function assertConfig(): void {
  if (
    !env.GROUP_REMINDER_CALLBACK_URL ||
    !/^https:\/\//u.test(env.GROUP_REMINDER_CALLBACK_URL)
  ) {
    throw new Error('GROUP_REMINDER_CALLBACK_URL must be an HTTPS URL');
  }
  if (env.REMINDER_TASK_SECRET.length < 24) {
    throw new Error('REMINDER_TASK_SECRET must contain at least 24 characters');
  }
}

export function calculateGroupReminderTime(
  scheduledAtMs: number,
  nowMs = Date.now()
): number {
  const remainingMs = scheduledAtMs - nowMs;
  if (remainingMs < 2 * 60_000) {
    throw new Error('Group schedule must be at least 2 minutes in the future');
  }
  const configuredLeadMs = env.GROUP_REMINDER_LEAD_MINUTES * 60_000;
  const leadMs = Math.min(configuredLeadMs, Math.floor(remainingMs / 2));
  return scheduledAtMs - leadMs;
}

export function buildGroupReminderTask(
  schedule: GroupSchedule,
  reminderAtMs: number
): protos.google.cloud.tasks.v2.ITask {
  assertConfig();
  const taskName = tasksClient.taskPath(
    env.GOOGLE_CLOUD_PROJECT,
    env.CLOUD_TASKS_LOCATION,
    env.CLOUD_TASKS_QUEUE,
    `group-schedule-${schedule.id}`
  );
  return {
    name: taskName,
    scheduleTime: { seconds: Math.floor(reminderAtMs / 1000) },
    httpRequest: {
      httpMethod: 'POST',
      url: env.GROUP_REMINDER_CALLBACK_URL,
      headers: {
        'Content-Type': 'application/json',
        'X-Cafe-Reminder-Secret': env.REMINDER_TASK_SECRET
      },
      body: Buffer.from(JSON.stringify({
        conversationId: schedule.conversationId,
        scheduleId: schedule.id
      })).toString('base64')
    }
  };
}

export async function ensureGroupReminder(
  schedule: GroupSchedule
): Promise<GroupSchedule> {
  if (schedule.reminderStatus !== 'none') return schedule;
  const option = confirmedGroupScheduleOption(schedule);
  if (schedule.status !== 'confirmed' || !option) {
    throw new Error('Group schedule is not confirmed');
  }
  const reminderAtMs = calculateGroupReminderTime(option.scheduledAtMs);
  const task = buildGroupReminderTask(schedule, reminderAtMs);
  const parent = tasksClient.queuePath(
    env.GOOGLE_CLOUD_PROJECT,
    env.CLOUD_TASKS_LOCATION,
    env.CLOUD_TASKS_QUEUE
  );
  let taskName = task.name ?? '';
  try {
    const [created] = await tasksClient.createTask({ parent, task });
    taskName = created.name ?? taskName;
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 6)) {
      throw error;
    }
  }
  return attachGroupReminder({
    conversationId: schedule.conversationId,
    scheduleId: schedule.id,
    reminderAtMs,
    taskName
  });
}
