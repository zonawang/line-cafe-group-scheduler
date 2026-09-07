import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

const { countGroupPlanVotes, groupPlanStoreInternals } = await import('./groupPlanStore.js');

test('uses the Maps URI to create a stable safe candidate ID', () => {
  const first = groupPlanStoreInternals.candidateId({
    title: 'Cafe A',
    uri: 'https://maps.google.com/cafe-a'
  });
  const renamed = groupPlanStoreInternals.candidateId({
    title: 'Cafe A Renamed',
    uri: 'https://maps.google.com/cafe-a'
  });
  assert.equal(first, renamed);
  assert.match(first, /^[A-Za-z0-9_-]{20}$/u);
});

test('counts one current vote per member', () => {
  const plan = {
    id: 'plan_1',
    conversationId: 'group_1',
    creatorId: 'user_1',
    status: 'open' as const,
    candidates: [
      { id: 'cafe_1', title: 'Cafe A', uri: 'https://maps.google.com/a' },
      { id: 'cafe_2', title: 'Cafe B', uri: 'https://maps.google.com/b' }
    ],
    votes: { user_1: 'cafe_2', user_2: 'cafe_2', user_3: 'missing' },
    createdAtMs: 1,
    expiresAtMs: 2
  };
  assert.deepEqual(Object.fromEntries(countGroupPlanVotes(plan)), {
    cafe_1: 0,
    cafe_2: 2
  });
});
