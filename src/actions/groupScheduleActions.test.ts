import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGroupScheduleChooseData,
  createGroupScheduleDatetimeAction,
  createGroupScheduleFinishData,
  createGroupScheduleRemindData,
  createGroupScheduleStartData,
  createGroupScheduleVoteData,
  parseGroupSchedulePostbackData
} from './groupScheduleActions.js';

test('round-trips every group schedule action', () => {
  const values = [
    createGroupScheduleStartData('plan_1'),
    createGroupScheduleDatetimeAction('schedule_1', Date.parse('2026-09-07T00:00:00Z')).data,
    createGroupScheduleVoteData('schedule_1', 'option_1'),
    createGroupScheduleFinishData('schedule_1'),
    createGroupScheduleChooseData('schedule_1', 'option_1'),
    createGroupScheduleRemindData('schedule_1')
  ];
  assert.deepEqual(values.map((value) => parseGroupSchedulePostbackData(value ?? '')), [
    { action: 'start', planId: 'plan_1' },
    { action: 'add', scheduleId: 'schedule_1' },
    { action: 'vote', scheduleId: 'schedule_1', optionId: 'option_1' },
    { action: 'finish', scheduleId: 'schedule_1' },
    { action: 'choose', scheduleId: 'schedule_1', optionId: 'option_1' },
    { action: 'remind', scheduleId: 'schedule_1' }
  ]);
});

test('rejects malformed and unsafe schedule actions', () => {
  assert.equal(parseGroupSchedulePostbackData('v=1&gs=start&p=bad/plan'), undefined);
  assert.equal(parseGroupSchedulePostbackData('v=1&gs=vote&s=schedule&o=bad/option'), undefined);
  assert.equal(parseGroupSchedulePostbackData('v=2&gs=finish&s=schedule'), undefined);
  assert.throws(() => createGroupScheduleVoteData('schedule', 'bad/option'));
});

test('creates a Taipei datetime window from 10 minutes to 60 days', () => {
  const now = Date.parse('2026-09-07T00:00:00.000Z');
  const action = createGroupScheduleDatetimeAction('schedule_1', now);
  assert.equal(action.mode, 'datetime');
  assert.equal(action.min, '2026-09-07T08:10');
  assert.equal(action.max, '2026-11-06T08:00');
});

test('keeps schedule postbacks within the LINE 300 character limit', () => {
  assert.equal(createGroupScheduleVoteData('s'.repeat(128), 'o'.repeat(128)).length <= 300, true);
  assert.equal(createGroupScheduleChooseData('s'.repeat(128), 'o'.repeat(128)).length <= 300, true);
});
