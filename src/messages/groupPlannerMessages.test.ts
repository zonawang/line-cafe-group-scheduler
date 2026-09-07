import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

const {
  createCandidateAddedMessage,
  createGroupJoinMessage,
  createGroupOnlyMessage,
  createGroupPlanFinalMessage,
  createGroupPlanMessages,
  createGroupPlanOwnerRequiredMessages,
  createGroupPlanStartedMessage,
  createGroupSearchLoadingMessage,
  createVoteRecordedMessages
} = await import('./groupPlannerMessages.js');

const openPlan = {
  id: 'plan_1',
  conversationId: 'group_1',
  creatorId: 'user_1',
  status: 'open' as const,
  candidates: [
    { id: 'cafe_1', title: 'Cafe A', uri: 'https://maps.google.com/a' },
    { id: 'cafe_2', title: 'Cafe B', uri: 'https://maps.google.com/b' }
  ],
  votes: { user_1: 'cafe_2', user_2: 'cafe_2' },
  createdAtMs: 1,
  expiresAtMs: 2
};

test('explains that planning must start in a group', () => {
  assert.match(createGroupOnlyMessage().text, /群組/);
});

test('introduces the command when invited to a group', () => {
  assert.match(createGroupJoinMessage().text, /一起選咖啡廳/);
});

test('uses a text status while searching in a group', () => {
  assert.match(createGroupSearchLoadingMessage().text, /正在幫大家找/);
  assert.match(createGroupSearchLoadingMessage().text, /加入群組候選/);
});

test('starts with a location quick reply', () => {
  const message = createGroupPlanStartedMessage();
  assert.equal((message.quickReply?.items ?? [])[0]?.action?.type, 'location');
});

test('creates candidate confirmation with vote entry', () => {
  const message = createCandidateAddedMessage('Cafe A', true, 2);
  assert.match(message.text, /2\/5/);
  assert.equal((message.quickReply?.items ?? [])[0]?.action?.type, 'message');
});

test('creates one vote card per candidate and a finish action', () => {
  const message = createGroupPlanMessages(openPlan)[0];
  assert.equal(message?.type, 'flex');
  if (message?.type !== 'flex' || message.contents.type !== 'carousel') return;
  assert.equal(message.contents.contents.length, 2);
  assert.equal((message.quickReply?.items ?? [])[1]?.action?.type, 'postback');
  const second = message.contents.contents[1];
  assert.equal(second?.type, 'bubble');
  if (second?.type !== 'bubble' || !second.body || second.body.type !== 'box') return;
  assert.equal(second.body.contents.some(
    (content) => content.type === 'text' && content.text === '2 票'
  ), true);
});

test('records a vote and returns refreshed standings', () => {
  const messages = createVoteRecordedMessages(openPlan, 'Cafe B');
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.type, 'text');
  if (messages[0]?.type === 'text') assert.match(messages[0].text, /Cafe B/);
});

test('returns the live vote and finish action when a non-owner tries to finish', () => {
  const messages = createGroupPlanOwnerRequiredMessages(openPlan);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.type, 'text');
  if (messages[0]?.type === 'text') assert.match(messages[0].text, /原發起人/);
  const voteMessage = messages[1];
  assert.equal(voteMessage?.type, 'flex');
  if (voteMessage?.type !== 'flex') return;
  assert.equal((voteMessage.quickReply?.items ?? [])[1]?.action?.type, 'postback');
});

test('announces a single winner and links to Maps', () => {
  const message = createGroupPlanFinalMessage({ ...openPlan, status: 'finalized' });
  assert.match(message.text, /Cafe B/);
  assert.match(message.text, /2 票/);
  assert.equal((message.quickReply?.items ?? [])[0]?.action?.type, 'postback');
  assert.equal((message.quickReply?.items ?? [])[1]?.action?.type, 'uri');
});

test('announces a tie without choosing a fake winner', () => {
  const message = createGroupPlanFinalMessage({
    ...openPlan,
    status: 'finalized',
    votes: { user_1: 'cafe_1', user_2: 'cafe_2' }
  });
  assert.match(message.text, /平手/);
  assert.equal(message.quickReply, undefined);
});
