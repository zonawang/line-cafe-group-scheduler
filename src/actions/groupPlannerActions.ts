import type { messagingApi } from '@line/bot-sdk';

export type GroupPlannerPostback =
  | { action: 'add'; planId: string; sessionId: string; cafeNumber: number }
  | { action: 'vote'; planId: string; candidateId: string }
  | { action: 'finish'; planId: string };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const VERSION = '1';

function validId(value: string | null): value is string {
  return Boolean(value && ID_PATTERN.test(value));
}

export function createGroupCandidateData(
  planId: string,
  sessionId: string,
  cafeNumber: number
): string {
  if (!validId(planId) || !validId(sessionId) || !Number.isInteger(cafeNumber) || cafeNumber < 1 || cafeNumber > 5) {
    throw new Error('Invalid group candidate action');
  }
  return new URLSearchParams({
    v: VERSION,
    ga: 'add',
    p: planId,
    s: sessionId,
    c: String(cafeNumber)
  }).toString();
}

export function createGroupVoteData(planId: string, candidateId: string): string {
  if (!validId(planId) || !validId(candidateId)) {
    throw new Error('Invalid group vote action');
  }
  return new URLSearchParams({
    v: VERSION,
    ga: 'vote',
    p: planId,
    c: candidateId
  }).toString();
}

export function createGroupFinishData(planId: string): string {
  if (!validId(planId)) throw new Error('Invalid group plan ID');
  return new URLSearchParams({ v: VERSION, ga: 'finish', p: planId }).toString();
}

export function createGroupFinishAction(
  planId: string
): messagingApi.PostbackAction {
  return {
    type: 'postback',
    label: '截止並公布結果',
    data: createGroupFinishData(planId),
    displayText: '截止群組投票'
  };
}

export function parseGroupPlannerPostbackData(
  data: string
): GroupPlannerPostback | undefined {
  const params = new URLSearchParams(data);
  if (params.get('v') !== VERSION) return undefined;

  const action = params.get('ga');
  if (action === 'add') {
    const planId = params.get('p');
    const sessionId = params.get('s');
    const cafeNumber = Number(params.get('c'));
    if (!validId(planId) || !validId(sessionId) || !Number.isInteger(cafeNumber) || cafeNumber < 1 || cafeNumber > 5) {
      return undefined;
    }
    return { action, planId, sessionId, cafeNumber };
  }

  const planId = params.get('p');
  if (!validId(planId)) return undefined;
  if (action === 'finish') return { action, planId };
  if (action === 'vote') {
    const candidateId = params.get('c');
    if (!validId(candidateId)) return undefined;
    return { action, planId, candidateId };
  }
  return undefined;
}

export const groupPlannerActionInternals = { ID_PATTERN };
