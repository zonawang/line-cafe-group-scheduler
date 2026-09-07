import { createHash, randomBytes } from 'node:crypto';

import { Firestore, Timestamp } from '@google-cloud/firestore';

import { env } from '../utils/env.js';
import {
  countGroupPlanVotes,
  type GroupPlan
} from './groupPlanStore.js';
import type { CafeSearchSource } from './searchSessionStore.js';

export type GroupScheduleStatus = 'collecting' | 'tie_break' | 'confirmed';
export type GroupReminderStatus = 'none' | 'scheduled' | 'sending' | 'sent';

export type GroupScheduleOption = {
  id: string;
  scheduledAtMs: number;
  proposerId: string;
  createdAtMs: number;
};

export type GroupSchedule = {
  id: string;
  conversationId: string;
  creatorId: string;
  groupPlanId: string;
  cafe: CafeSearchSource;
  status: GroupScheduleStatus;
  options: GroupScheduleOption[];
  votes: Record<string, string>;
  tiedOptionIds: string[];
  confirmedOptionId?: string;
  reminderStatus: GroupReminderStatus;
  reminderAtMs?: number;
  reminderTaskName?: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type StoredGroupSchedule = Omit<GroupSchedule, 'createdAtMs' | 'expiresAtMs'> & {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  reminderLeaseUntilMs?: number;
};

export type GroupScheduleErrorCode =
  | 'not_found'
  | 'expired'
  | 'stale'
  | 'forbidden'
  | 'cafe_vote_required'
  | 'cafe_vote_tied'
  | 'active_schedule_exists'
  | 'already_confirmed'
  | 'not_collecting'
  | 'not_tied'
  | 'full'
  | 'no_options'
  | 'no_votes'
  | 'option_missing'
  | 'time_invalid'
  | 'not_ready'
  | 'busy';

export class GroupScheduleError extends Error {
  constructor(public readonly code: GroupScheduleErrorCode) {
    super(`Group schedule unavailable: ${code}`);
  }
}

const POLL_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_FUTURE_MS = 60 * 24 * 60 * 60_000;
const MIN_FUTURE_MS = 10 * 60_000;
const MIN_ACTIONABLE_MS = 2 * 60_000;
const MAX_OPTIONS = 5;
const DELIVERY_LEASE_MS = 5 * 60_000;

const firestore = new Firestore({ projectId: env.GOOGLE_CLOUD_PROJECT });
const schedules = firestore.collection(env.FIRESTORE_GROUP_SCHEDULES_COLLECTION);

function documentFor(conversationId: string) {
  const id = createHash('sha256').update(conversationId).digest('base64url').slice(0, 32);
  return schedules.doc(id);
}

function optionId(scheduleId: string, scheduledAtMs: number): string {
  return createHash('sha256')
    .update(`${scheduleId}:${scheduledAtMs}`)
    .digest('base64url')
    .slice(0, 20);
}

function toGroupSchedule(data: StoredGroupSchedule): GroupSchedule {
  return {
    id: data.id,
    conversationId: data.conversationId,
    creatorId: data.creatorId,
    groupPlanId: data.groupPlanId,
    cafe: data.cafe,
    status: data.status,
    options: data.options ?? [],
    votes: data.votes ?? {},
    tiedOptionIds: data.tiedOptionIds ?? [],
    confirmedOptionId: data.confirmedOptionId,
    reminderStatus: data.reminderStatus ?? 'none',
    reminderAtMs: data.reminderAtMs,
    reminderTaskName: data.reminderTaskName,
    createdAtMs: data.createdAt.toMillis(),
    expiresAtMs: data.expiresAt.toMillis()
  };
}

function assertCurrent(
  data: StoredGroupSchedule | undefined,
  scheduleId?: string
): asserts data is StoredGroupSchedule {
  if (!data) throw new GroupScheduleError('not_found');
  if (scheduleId && data.id !== scheduleId) throw new GroupScheduleError('stale');
  if (data.expiresAt.toMillis() <= Date.now()) throw new GroupScheduleError('expired');
}

export function findSingleCafeWinner(plan: GroupPlan): CafeSearchSource | undefined {
  if (plan.status !== 'finalized') return undefined;
  const counts = countGroupPlanVotes(plan);
  const highest = Math.max(0, ...counts.values());
  if (highest === 0) return undefined;
  const winners = plan.candidates.filter(
    (candidate) => (counts.get(candidate.id) ?? 0) === highest
  );
  return winners.length === 1 ? winners[0] : undefined;
}

export async function createGroupSchedule(input: {
  plan: GroupPlan;
  conversationId: string;
  actorId: string;
}): Promise<{ schedule: GroupSchedule; created: boolean }> {
  if (input.plan.conversationId !== input.conversationId) {
    throw new GroupScheduleError('forbidden');
  }
  if (input.plan.creatorId !== input.actorId) {
    throw new GroupScheduleError('forbidden');
  }
  if (input.plan.status !== 'finalized') {
    throw new GroupScheduleError('cafe_vote_required');
  }
  const cafe = findSingleCafeWinner(input.plan);
  if (!cafe) {
    const counts = countGroupPlanVotes(input.plan);
    const highest = Math.max(0, ...counts.values());
    throw new GroupScheduleError(highest === 0 ? 'cafe_vote_required' : 'cafe_vote_tied');
  }

  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (snapshot.exists) {
      const current = snapshot.data() as StoredGroupSchedule;
      if (
        current.groupPlanId === input.plan.id &&
        current.expiresAt.toMillis() > Date.now()
      ) {
        return { schedule: toGroupSchedule(current), created: false };
      }
      const confirmed = current.options.find(
        (option) => option.id === current.confirmedOptionId
      );
      if (
        current.status === 'confirmed' &&
        confirmed &&
        confirmed.scheduledAtMs > Date.now()
      ) {
        throw new GroupScheduleError('active_schedule_exists');
      }
    }
    const now = Date.now();
    const stored: StoredGroupSchedule = {
      id: randomBytes(9).toString('base64url'),
      conversationId: input.conversationId,
      creatorId: input.actorId,
      groupPlanId: input.plan.id,
      cafe,
      status: 'collecting',
      options: [],
      votes: {},
      tiedOptionIds: [],
      reminderStatus: 'none',
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + POLL_TTL_MS)
    };
    transaction.set(document, stored);
    return { schedule: toGroupSchedule(stored), created: true };
  });
}

export async function getGroupSchedule(
  conversationId: string,
  scheduleId?: string
): Promise<GroupSchedule> {
  const snapshot = await documentFor(conversationId).get();
  const data = snapshot.exists ? snapshot.data() as StoredGroupSchedule : undefined;
  assertCurrent(data, scheduleId);
  return toGroupSchedule(data);
}

export async function addGroupScheduleOption(input: {
  conversationId: string;
  scheduleId: string;
  proposerId: string;
  scheduledAtMs: number;
}): Promise<{ schedule: GroupSchedule; created: boolean }> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupSchedule : undefined;
    assertCurrent(data, input.scheduleId);
    if (data.status !== 'collecting') throw new GroupScheduleError('not_collecting');
    const now = Date.now();
    if (
      !Number.isFinite(input.scheduledAtMs) ||
      input.scheduledAtMs < now + MIN_FUTURE_MS ||
      input.scheduledAtMs > now + MAX_FUTURE_MS
    ) {
      throw new GroupScheduleError('time_invalid');
    }
    const activeOptions = data.options.filter(
      (option) => option.scheduledAtMs >= now + MIN_ACTIONABLE_MS
    );
    const activeIds = new Set(activeOptions.map((option) => option.id));
    const activeVotes = Object.fromEntries(
      Object.entries(data.votes).filter(([, votedOptionId]) => activeIds.has(votedOptionId))
    );
    const id = optionId(data.id, input.scheduledAtMs);
    if (activeOptions.some((option) => option.id === id)) {
      const normalized = { ...data, options: activeOptions, votes: activeVotes };
      if (activeOptions.length !== data.options.length) transaction.set(document, normalized);
      return { schedule: toGroupSchedule(normalized), created: false };
    }
    if (activeOptions.length >= MAX_OPTIONS) throw new GroupScheduleError('full');
    const updated: StoredGroupSchedule = {
      ...data,
      options: [...activeOptions, {
        id,
        scheduledAtMs: input.scheduledAtMs,
        proposerId: input.proposerId,
        createdAtMs: now
      }],
      votes: activeVotes,
      updatedAt: Timestamp.fromMillis(now)
    };
    transaction.set(document, updated);
    return { schedule: toGroupSchedule(updated), created: true };
  });
}

export async function voteForGroupScheduleOption(input: {
  conversationId: string;
  scheduleId: string;
  voterId: string;
  optionId: string;
}): Promise<GroupSchedule> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupSchedule : undefined;
    assertCurrent(data, input.scheduleId);
    if (data.status !== 'collecting') throw new GroupScheduleError('not_collecting');
    const option = data.options.find((candidate) => candidate.id === input.optionId);
    if (!option) {
      throw new GroupScheduleError('option_missing');
    }
    if (option.scheduledAtMs < Date.now() + MIN_ACTIONABLE_MS) {
      throw new GroupScheduleError('time_invalid');
    }
    const updated: StoredGroupSchedule = {
      ...data,
      votes: { ...data.votes, [input.voterId]: input.optionId },
      updatedAt: Timestamp.now()
    };
    transaction.set(document, updated);
    return toGroupSchedule(updated);
  });
}

export function countGroupScheduleVotes(schedule: GroupSchedule): Map<string, number> {
  const counts = new Map(schedule.options.map((option) => [option.id, 0]));
  for (const optionIdValue of Object.values(schedule.votes)) {
    if (counts.has(optionIdValue)) {
      counts.set(optionIdValue, (counts.get(optionIdValue) ?? 0) + 1);
    }
  }
  return counts;
}

export async function finalizeGroupSchedule(input: {
  conversationId: string;
  scheduleId: string;
  actorId: string;
}): Promise<GroupSchedule> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupSchedule : undefined;
    assertCurrent(data, input.scheduleId);
    if (data.creatorId !== input.actorId) throw new GroupScheduleError('forbidden');
    if (data.status !== 'collecting') throw new GroupScheduleError('not_collecting');
    const now = Date.now();
    const futureOptions = data.options.filter(
      (option) => option.scheduledAtMs >= now + MIN_ACTIONABLE_MS
    );
    if (futureOptions.length === 0) throw new GroupScheduleError('time_invalid');
    const futureIds = new Set(futureOptions.map((option) => option.id));
    const futureVotes = Object.fromEntries(
      Object.entries(data.votes).filter(([, optionIdValue]) => futureIds.has(optionIdValue))
    );
    if (Object.keys(futureVotes).length === 0) throw new GroupScheduleError('no_votes');
    const counts = new Map(futureOptions.map((option) => [option.id, 0]));
    for (const optionIdValue of Object.values(futureVotes)) {
      counts.set(optionIdValue, (counts.get(optionIdValue) ?? 0) + 1);
    }
    const highest = Math.max(...counts.values());
    const winners = futureOptions.filter(
      (option) => (counts.get(option.id) ?? 0) === highest
    );
    const singleWinner = winners.length === 1 ? winners[0] : undefined;
    const updated: StoredGroupSchedule = {
      ...data,
      options: futureOptions,
      votes: futureVotes,
      status: singleWinner ? 'confirmed' : 'tie_break',
      confirmedOptionId: singleWinner?.id,
      tiedOptionIds: singleWinner ? [] : winners.map((option) => option.id),
      updatedAt: Timestamp.now(),
      expiresAt: singleWinner
        ? Timestamp.fromMillis(singleWinner.scheduledAtMs + 7 * 24 * 60 * 60_000)
        : data.expiresAt
    };
    transaction.set(document, updated);
    return toGroupSchedule(updated);
  });
}

export async function chooseGroupScheduleTie(input: {
  conversationId: string;
  scheduleId: string;
  actorId: string;
  optionId: string;
}): Promise<GroupSchedule> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupSchedule : undefined;
    assertCurrent(data, input.scheduleId);
    if (data.creatorId !== input.actorId) throw new GroupScheduleError('forbidden');
    if (data.status !== 'tie_break') throw new GroupScheduleError('not_tied');
    const option = data.options.find(
      (candidate) => candidate.id === input.optionId && data.tiedOptionIds.includes(candidate.id)
    );
    if (!option) throw new GroupScheduleError('option_missing');
    if (option.scheduledAtMs < Date.now() + MIN_ACTIONABLE_MS) {
      throw new GroupScheduleError('time_invalid');
    }
    const updated: StoredGroupSchedule = {
      ...data,
      status: 'confirmed',
      confirmedOptionId: option.id,
      tiedOptionIds: [],
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(option.scheduledAtMs + 7 * 24 * 60 * 60_000)
    };
    transaction.set(document, updated);
    return toGroupSchedule(updated);
  });
}

export async function attachGroupReminder(input: {
  conversationId: string;
  scheduleId: string;
  reminderAtMs: number;
  taskName: string;
}): Promise<GroupSchedule> {
  const document = documentFor(input.conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    const data = snapshot.exists ? snapshot.data() as StoredGroupSchedule : undefined;
    assertCurrent(data, input.scheduleId);
    if (data.status !== 'confirmed') throw new GroupScheduleError('not_ready');
    if (data.reminderStatus !== 'none') return toGroupSchedule(data);
    const updated: StoredGroupSchedule = {
      ...data,
      reminderStatus: 'scheduled',
      reminderAtMs: input.reminderAtMs,
      reminderTaskName: input.taskName,
      updatedAt: Timestamp.now()
    };
    transaction.set(document, updated);
    return toGroupSchedule(updated);
  });
}

export async function claimGroupReminderDelivery(
  conversationId: string,
  scheduleId: string
): Promise<GroupSchedule | undefined> {
  const document = documentFor(conversationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) throw new GroupScheduleError('not_found');
    const data = snapshot.data() as StoredGroupSchedule;
    if (data.id !== scheduleId) throw new GroupScheduleError('stale');
    if (data.reminderStatus === 'sent') return undefined;
    if (data.status !== 'confirmed' || !data.reminderAtMs) {
      throw new GroupScheduleError('not_ready');
    }
    const now = Date.now();
    if (data.reminderAtMs > now + 60_000) throw new GroupScheduleError('not_ready');
    if (
      data.reminderStatus === 'sending' &&
      (data.reminderLeaseUntilMs ?? 0) > now
    ) {
      throw new GroupScheduleError('busy');
    }
    const updated: StoredGroupSchedule = {
      ...data,
      reminderStatus: 'sending',
      reminderLeaseUntilMs: now + DELIVERY_LEASE_MS,
      updatedAt: Timestamp.fromMillis(now)
    };
    transaction.set(document, updated);
    return toGroupSchedule(updated);
  });
}

export async function completeGroupReminderDelivery(
  conversationId: string,
  scheduleId: string
): Promise<void> {
  const document = documentFor(conversationId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return;
    const data = snapshot.data() as StoredGroupSchedule;
    if (data.id !== scheduleId || data.reminderStatus === 'sent') return;
    transaction.update(document, {
      reminderStatus: 'sent',
      reminderLeaseUntilMs: null,
      updatedAt: Timestamp.now()
    });
  });
}

export async function releaseGroupReminderDelivery(
  conversationId: string,
  scheduleId: string
): Promise<void> {
  const document = documentFor(conversationId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return;
    const data = snapshot.data() as StoredGroupSchedule;
    if (data.id === scheduleId && data.reminderStatus === 'sending') {
      transaction.update(document, {
        reminderStatus: 'scheduled',
        reminderLeaseUntilMs: null,
        updatedAt: Timestamp.now()
      });
    }
  });
}

export function confirmedGroupScheduleOption(
  schedule: GroupSchedule
): GroupScheduleOption | undefined {
  return schedule.options.find(
    (option) => option.id === schedule.confirmedOptionId
  );
}

export const groupScheduleStoreInternals = {
  optionId,
  MAX_OPTIONS,
  MIN_FUTURE_MS,
  MIN_ACTIONABLE_MS,
  MAX_FUTURE_MS,
  POLL_TTL_MS
};
