import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
process.env.CLOUD_TASKS_LOCATION = 'asia-east1';
process.env.CLOUD_TASKS_QUEUE = 'test-reminders';
process.env.REMINDER_TASK_SECRET = 'a-test-secret-with-more-than-24-characters';
process.env.GROUP_REMINDER_CALLBACK_URL = 'https://example.run.app/tasks/group-reminders';
process.env.GROUP_REMINDER_LEAD_MINUTES = '60';

const {
  buildGroupReminderTask,
  calculateGroupReminderTime
} = await import('./groupReminderScheduler.js');

const schedule = {
  id: 'schedule_123',
  conversationId: 'group_123',
  creatorId: 'user_1',
  groupPlanId: 'plan_1',
  cafe: { title: 'Zona Cafe', uri: 'https://maps.google.com/zona' },
  status: 'confirmed' as const,
  options: [{
    id: 'option_1',
    scheduledAtMs: Date.parse('2026-09-07T10:00:00Z'),
    proposerId: 'user_1',
    createdAtMs: 1
  }],
  votes: { user_1: 'option_1' },
  tiedOptionIds: [],
  confirmedOptionId: 'option_1',
  reminderStatus: 'none' as const,
  createdAtMs: 1,
  expiresAtMs: 2
};

test('reminds one hour before a distant event', () => {
  const now = Date.parse('2026-09-07T06:00:00Z');
  assert.equal(
    calculateGroupReminderTime(schedule.options[0]!.scheduledAtMs, now),
    Date.parse('2026-09-07T09:00:00Z')
  );
});

test('uses half the remaining time for a near event', () => {
  const now = Date.parse('2026-09-07T09:30:00Z');
  assert.equal(
    calculateGroupReminderTime(schedule.options[0]!.scheduledAtMs, now),
    Date.parse('2026-09-07T09:45:00Z')
  );
});

test('builds an authenticated deterministic group reminder task', () => {
  const reminderAt = Date.parse('2026-09-07T09:00:00Z');
  const task = buildGroupReminderTask(schedule, reminderAt);
  assert.match(task.name ?? '', /group-schedule-schedule_123$/u);
  assert.equal(task.httpRequest?.url, process.env.GROUP_REMINDER_CALLBACK_URL);
  assert.equal(task.httpRequest?.headers?.['X-Cafe-Reminder-Secret'], process.env.REMINDER_TASK_SECRET);
  const body = Buffer.from(String(task.httpRequest?.body), 'base64').toString('utf8');
  assert.deepEqual(JSON.parse(body), {
    conversationId: 'group_123',
    scheduleId: 'schedule_123'
  });
});
