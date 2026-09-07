import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

const {
  countGroupScheduleVotes,
  findSingleCafeWinner,
  groupScheduleStoreInternals
} = await import('./groupScheduleStore.js');

const finalizedPlan = {
  id: 'plan_1',
  conversationId: 'group_1',
  creatorId: 'user_1',
  status: 'finalized' as const,
  candidates: [
    { id: 'cafe_1', title: 'Cafe A', uri: 'https://maps.google.com/a' },
    { id: 'cafe_2', title: 'Cafe B', uri: 'https://maps.google.com/b' }
  ],
  votes: { user_1: 'cafe_2', user_2: 'cafe_2' },
  createdAtMs: 1,
  expiresAtMs: Date.now() + 10_000
};

test('finds only a single voted cafe winner', () => {
  assert.equal(findSingleCafeWinner(finalizedPlan)?.title, 'Cafe B');
  assert.equal(findSingleCafeWinner({ ...finalizedPlan, votes: {} }), undefined);
  assert.equal(findSingleCafeWinner({
    ...finalizedPlan,
    votes: { user_1: 'cafe_1', user_2: 'cafe_2' }
  }), undefined);
});

test('counts one current schedule vote per member', () => {
  const schedule = {
    id: 'schedule_1',
    conversationId: 'group_1',
    creatorId: 'user_1',
    groupPlanId: 'plan_1',
    cafe: finalizedPlan.candidates[1]!,
    status: 'collecting' as const,
    options: [
      { id: 'option_1', scheduledAtMs: 100, proposerId: 'user_1', createdAtMs: 1 },
      { id: 'option_2', scheduledAtMs: 200, proposerId: 'user_2', createdAtMs: 2 }
    ],
    votes: { user_1: 'option_2', user_2: 'option_2', user_3: 'missing' },
    tiedOptionIds: [],
    reminderStatus: 'none' as const,
    createdAtMs: 1,
    expiresAtMs: 2
  };
  assert.deepEqual(Object.fromEntries(countGroupScheduleVotes(schedule)), {
    option_1: 0,
    option_2: 2
  });
});

test('creates deterministic safe option IDs', () => {
  const first = groupScheduleStoreInternals.optionId('schedule_1', 123456789);
  const again = groupScheduleStoreInternals.optionId('schedule_1', 123456789);
  assert.equal(first, again);
  assert.match(first, /^[A-Za-z0-9_-]{20}$/u);
  assert.equal(groupScheduleStoreInternals.MAX_OPTIONS, 5);
});
