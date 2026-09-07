import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

const {
  createGroupScheduleConfirmedMessage,
  createGroupScheduleMessages,
  createGroupScheduleOptionAddedMessage,
  createGroupScheduleOwnerRequiredMessages,
  createGroupScheduleReminderMessage,
  createGroupScheduleStartedMessage,
  createGroupScheduleTieMessages,
  createGroupScheduleVoteRecordedMessages
} = await import('./groupScheduleMessages.js');

const future = Date.now() + 2 * 24 * 60 * 60_000;
const openSchedule = {
  id: 'schedule_1',
  conversationId: 'group_1',
  creatorId: 'user_1',
  groupPlanId: 'plan_1',
  cafe: { title: 'Cafe A', uri: 'https://maps.google.com/a' },
  status: 'collecting' as const,
  options: [
    { id: 'option_1', scheduledAtMs: future, proposerId: 'user_1', createdAtMs: 1 },
    { id: 'option_2', scheduledAtMs: future + 3_600_000, proposerId: 'user_2', createdAtMs: 2 }
  ],
  votes: { user_1: 'option_2', user_2: 'option_2' },
  tiedOptionIds: [],
  reminderStatus: 'none' as const,
  createdAtMs: 1,
  expiresAtMs: future
};

test('starts a schedule with datetime and view actions', () => {
  const message = createGroupScheduleStartedMessage(openSchedule, true);
  assert.match(message.text, /Cafe A/);
  assert.deepEqual(
    (message.quickReply?.items ?? []).map((item) => item.action?.type),
    ['datetimepicker', 'message']
  );
});

test('confirms an added option and shows the five-option limit', () => {
  const message = createGroupScheduleOptionAddedMessage(
    openSchedule,
    openSchedule.options[0]!,
    true
  );
  assert.match(message.text, /2\/5/);
  assert.deepEqual(
    (message.quickReply?.items ?? []).map((item) => item.action?.type),
    ['datetimepicker', 'message']
  );
});

test('stops offering more times when all five candidate slots are used', () => {
  const fullSchedule = {
    ...openSchedule,
    options: Array.from({ length: 5 }, (_, index) => ({
      id: `option_${index + 1}`,
      scheduledAtMs: future + index * 3_600_000,
      proposerId: 'user_1',
      createdAtMs: index + 1
    }))
  };
  const message = createGroupScheduleOptionAddedMessage(
    fullSchedule,
    fullSchedule.options[4]!,
    true
  );
  assert.match(message.text, /5\/5/);
  assert.deepEqual(
    (message.quickReply?.items ?? []).map((item) => item.action?.type),
    ['message']
  );
});

test('creates vote cards and controls', () => {
  const message = createGroupScheduleMessages(openSchedule)[0];
  assert.equal(message?.type, 'flex');
  if (message?.type !== 'flex' || message.contents.type !== 'carousel') return;
  assert.equal(message.contents.contents.length, 2);
  assert.deepEqual(
    (message.quickReply?.items ?? []).map((item) => item.action?.type),
    ['datetimepicker', 'message', 'postback']
  );
  assert.match(message.altText, /2 人/);
});

test('records a vote and returns refreshed standings', () => {
  const messages = createGroupScheduleVoteRecordedMessages(openSchedule, openSchedule.options[1]!);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.type, 'text');
  if (messages[0]?.type === 'text') assert.match(messages[0].text, /再次投票會改票/);
});

test('returns the live time vote and finish action when a non-owner tries to finish', () => {
  const messages = createGroupScheduleOwnerRequiredMessages(openSchedule);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.type, 'text');
  if (messages[0]?.type === 'text') assert.match(messages[0].text, /原發起人/);
  const voteMessage = messages[1];
  assert.equal(voteMessage?.type, 'flex');
  if (voteMessage?.type !== 'flex') return;
  assert.equal((voteMessage.quickReply?.items ?? [])[2]?.action?.type, 'postback');
});

test('creates creator tie-break cards', () => {
  const messages = createGroupScheduleTieMessages({
    ...openSchedule,
    status: 'tie_break',
    tiedOptionIds: ['option_1', 'option_2']
  });
  assert.equal(messages[0]?.type, 'flex');
  if (messages[0]?.type !== 'flex' || messages[0].contents.type !== 'carousel') return;
  assert.equal(messages[0].contents.contents.length, 2);
  assert.match(messages[0].altText, /平手/);
});

test('creates Calendar, Maps, and reminder retry actions', () => {
  const schedule = {
    ...openSchedule,
    status: 'confirmed' as const,
    confirmedOptionId: 'option_2'
  };
  const message = createGroupScheduleConfirmedMessage(schedule, false);
  assert.match(message.text, /地點和時間都決定/);
  assert.deepEqual(
    (message.quickReply?.items ?? []).map((item) => item.action?.type),
    ['uri', 'uri', 'postback']
  );
});

test('creates a group reminder with cafe and map action', () => {
  const schedule = {
    ...openSchedule,
    status: 'confirmed' as const,
    confirmedOptionId: 'option_1'
  };
  const message = createGroupScheduleReminderMessage(schedule);
  assert.match(message.text, /Cafe A/);
  assert.equal((message.quickReply?.items ?? [])[0]?.action?.type, 'uri');
});
