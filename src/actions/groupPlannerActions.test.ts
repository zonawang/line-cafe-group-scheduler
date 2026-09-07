import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGroupCandidateData,
  createGroupFinishAction,
  createGroupFinishData,
  createGroupVoteData,
  parseGroupPlannerPostbackData
} from './groupPlannerActions.js';

test('round-trips add, vote, and finish postbacks', () => {
  assert.deepEqual(
    parseGroupPlannerPostbackData(createGroupCandidateData('plan_1', 'session_1', 3)),
    { action: 'add', planId: 'plan_1', sessionId: 'session_1', cafeNumber: 3 }
  );
  assert.deepEqual(
    parseGroupPlannerPostbackData(createGroupVoteData('plan_1', 'cafe_1')),
    { action: 'vote', planId: 'plan_1', candidateId: 'cafe_1' }
  );
  assert.deepEqual(
    parseGroupPlannerPostbackData(createGroupFinishData('plan_1')),
    { action: 'finish', planId: 'plan_1' }
  );
});

test('rejects malformed group planner actions', () => {
  assert.equal(parseGroupPlannerPostbackData('v=1&ga=add&p=plan&s=bad/session&c=1'), undefined);
  assert.equal(parseGroupPlannerPostbackData('v=1&ga=add&p=plan&s=session&c=8'), undefined);
  assert.equal(parseGroupPlannerPostbackData('v=1&ga=vote&p=plan&c=bad/cafe'), undefined);
  assert.equal(parseGroupPlannerPostbackData('v=2&ga=finish&p=plan'), undefined);
});

test('keeps group planner postback data within LINE limit', () => {
  assert.equal(createGroupCandidateData('p'.repeat(128), 's'.repeat(128), 5).length <= 300, true);
  assert.equal(createGroupVoteData('p'.repeat(128), 'c'.repeat(128)).length <= 300, true);
});

test('creates a finish postback action', () => {
  const action = createGroupFinishAction('plan_1');
  assert.equal(action.type, 'postback');
  assert.equal(action.label, '截止並公布結果');
  assert.deepEqual(parseGroupPlannerPostbackData(action.data ?? ''), {
    action: 'finish',
    planId: 'plan_1'
  });
});
