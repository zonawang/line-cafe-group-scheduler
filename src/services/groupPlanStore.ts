import { createHash, randomBytes } from 'node:crypto';

import { Firestore, Timestamp } from '@google-cloud/firestore';

import { env } from '../utils/env.js';
import type { CafeSearchSource } from './searchSessionStore.js';

export type GroupPlanCandidate = CafeSearchSource & { id: string };
export type GroupPlan = {
  id: string;
  conversationId: string;
  creatorId: string;
  status: 'open' | 'finalized';
  candidates: GroupPlanCandidate[];
  votes: Record<string, string>;
  createdAtMs: number;
  expiresAtMs: number;
};

type StoredGroupPlan = Omit<GroupPlan, 'createdAtMs' | 'expiresAtMs'> & {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
};

export type GroupPlanErrorCode =
  | 'not_found'
  | 'expired'
  | 'stale'
  | 'finalized'
  | 'forbidden'
  | 'full'
  | 'no_candidates'
  | 'candidate_missing';

export class GroupPlanError extends Error {
  constructor(public readonly code: GroupPlanErrorCode) {
    super(`Group plan unavailable: ${code}`);
  }
}

const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 5;
const firestore = new Firestore({ projectId: env.GOOGLE_CLOUD_PROJECT });
const plans = firestore.collection(env.FIRESTORE_GROUP_PLANS_COLLECTION);

function documentFor(conversationId: string) {
  const id = createHash('sha256').update(conversationId).digest('base64url').slice(0, 32);
  return plans.doc(id);
}

function candidateId(cafe: CafeSearchSource): string {
  return createHash('sha256')
    .update(cafe.uri.trim().toLocaleLowerCase('en-US'))
    .digest('base64url')
    .slice(0, 20);
}

function toGroupPlan(data: StoredGroupPlan): GroupPlan {
  return {
    id: data.id,
    conversationId: data.conversationId,
    creatorId: data.creatorId,
    status: data.status,
    candidates: data.candidates ?? [],
    votes: data.votes ?? {},
    createdAtMs: data.createdAt.toMillis(),
    expiresAtMs: data.expiresAt.toMillis()
  };
}

function assertCurrent(
  data: StoredGroupPlan | undefined,
  planId?: string,
  requireOpen = false
): asserts data is StoredGroupPlan {
  if (!data) throw new GroupPlanError('not_found');
  if (planId && data.id !== planId) throw new GroupPlanError('stale');
  if (data.expiresAt.toMillis() <= Date.now()) throw new GroupPlanError('expired');
  if (requireOpen && data.status !== 'open') throw new GroupPlanError('finalized');
}

export async function createGroupPlan(input: {
  conversationId: string;
  creatorId: string;
}): Promise<{ plan: GroupPlan; created: boolean }> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (snapshot.exists) {
      const current = snapshot.data() as StoredGroupPlan;
      if (current.status === 'open' && current.expiresAt.toMillis() > Date.now()) {
        return { plan: toGroupPlan(current), created: false };
      }
    }

    const now = Date.now();
    const data: StoredGroupPlan = {
      id: randomBytes(9).toString('base64url'),
      conversationId: input.conversationId,
      creatorId: input.creatorId,
      status: 'open',
      candidates: [],
      votes: {},
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + PLAN_TTL_MS)
    };
    transaction.set(document, data);
    return { plan: toGroupPlan(data), created: true };
  });
}

export async function getGroupPlan(conversationId: string): Promise<GroupPlan> {
  const snapshot = await documentFor(conversationId).get();
  const data = snapshot.exists ? snapshot.data() as StoredGroupPlan : undefined;
  assertCurrent(data);
  return toGroupPlan(data);
}

export async function addGroupCandidate(input: {
  conversationId: string;
  planId: string;
  cafe: CafeSearchSource;
}): Promise<{ plan: GroupPlan; created: boolean }> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupPlan : undefined;
    assertCurrent(data, input.planId, true);
    const id = candidateId(input.cafe);
    if (data.candidates.some((candidate) => candidate.id === id)) {
      return { plan: toGroupPlan(data), created: false };
    }
    if (data.candidates.length >= MAX_CANDIDATES) throw new GroupPlanError('full');
    const updated: StoredGroupPlan = {
      ...data,
      candidates: [...data.candidates, { ...input.cafe, id }],
      updatedAt: Timestamp.now()
    };
    transaction.set(document, updated);
    return { plan: toGroupPlan(updated), created: true };
  });
}

export async function voteForGroupCandidate(input: {
  conversationId: string;
  planId: string;
  voterId: string;
  candidateId: string;
}): Promise<GroupPlan> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupPlan : undefined;
    assertCurrent(data, input.planId, true);
    if (!data.candidates.some((candidate) => candidate.id === input.candidateId)) {
      throw new GroupPlanError('candidate_missing');
    }
    const updated: StoredGroupPlan = {
      ...data,
      votes: { ...data.votes, [input.voterId]: input.candidateId },
      updatedAt: Timestamp.now()
    };
    transaction.set(document, updated);
    return toGroupPlan(updated);
  });
}

export async function finalizeGroupPlan(input: {
  conversationId: string;
  planId: string;
  actorId: string;
}): Promise<GroupPlan> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupPlan : undefined;
    assertCurrent(data, input.planId, true);
    if (data.creatorId !== input.actorId) throw new GroupPlanError('forbidden');
    if (data.candidates.length === 0) throw new GroupPlanError('no_candidates');
    const updated: StoredGroupPlan = {
      ...data,
      status: 'finalized',
      updatedAt: Timestamp.now()
    };
    transaction.set(document, updated);
    return toGroupPlan(updated);
  });
}

export function countGroupPlanVotes(plan: GroupPlan): Map<string, number> {
  const counts = new Map(plan.candidates.map((candidate) => [candidate.id, 0]));
  for (const candidateIdValue of Object.values(plan.votes)) {
    if (counts.has(candidateIdValue)) {
      counts.set(candidateIdValue, (counts.get(candidateIdValue) ?? 0) + 1);
    }
  }
  return counts;
}

export const groupPlanStoreInternals = {
  candidateId,
  MAX_CANDIDATES,
  PLAN_TTL_MS
};
