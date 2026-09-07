import type { messagingApi } from '@line/bot-sdk';

export type GroupSchedulePostback =
  | { action: 'start'; planId: string }
  | { action: 'add'; scheduleId: string }
  | { action: 'vote'; scheduleId: string; optionId: string }
  | { action: 'finish'; scheduleId: string }
  | { action: 'choose'; scheduleId: string; optionId: string }
  | { action: 'remind'; scheduleId: string };

const VERSION = '1';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function validId(value: string | null): value is string {
  return Boolean(value && ID_PATTERN.test(value));
}

function data(values: Record<string, string>): string {
  return new URLSearchParams({ v: VERSION, ...values }).toString();
}

export function createGroupScheduleStartData(planId: string): string {
  if (!validId(planId)) throw new Error('Invalid group plan ID');
  return data({ gs: 'start', p: planId });
}

export function createGroupScheduleVoteData(
  scheduleId: string,
  optionId: string
): string {
  if (!validId(scheduleId) || !validId(optionId)) {
    throw new Error('Invalid group schedule vote');
  }
  return data({ gs: 'vote', s: scheduleId, o: optionId });
}

export function createGroupScheduleFinishData(scheduleId: string): string {
  if (!validId(scheduleId)) throw new Error('Invalid group schedule ID');
  return data({ gs: 'finish', s: scheduleId });
}

export function createGroupScheduleChooseData(
  scheduleId: string,
  optionId: string
): string {
  if (!validId(scheduleId) || !validId(optionId)) {
    throw new Error('Invalid group schedule tie-break');
  }
  return data({ gs: 'choose', s: scheduleId, o: optionId });
}

export function createGroupScheduleRemindData(scheduleId: string): string {
  if (!validId(scheduleId)) throw new Error('Invalid group schedule ID');
  return data({ gs: 'remind', s: scheduleId });
}

function taipeiDatetime(valueMs: number): string {
  return new Date(valueMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function createGroupScheduleDatetimeAction(
  scheduleId: string,
  nowMs = Date.now()
): messagingApi.DatetimePickerAction {
  if (!validId(scheduleId)) throw new Error('Invalid group schedule ID');
  return {
    type: 'datetimepicker',
    label: '提出候選時間',
    data: data({ gs: 'add', s: scheduleId }),
    mode: 'datetime',
    min: taipeiDatetime(nowMs + 10 * 60_000),
    max: taipeiDatetime(nowMs + 60 * 24 * 60 * 60_000)
  };
}

export function parseGroupSchedulePostbackData(
  raw: string
): GroupSchedulePostback | undefined {
  const params = new URLSearchParams(raw);
  if (params.get('v') !== VERSION) return undefined;
  const action = params.get('gs');
  if (action === 'start') {
    const planId = params.get('p');
    return validId(planId) ? { action, planId } : undefined;
  }
  const scheduleId = params.get('s');
  if (!validId(scheduleId)) return undefined;
  if (action === 'add' || action === 'finish' || action === 'remind') {
    return { action, scheduleId };
  }
  if (action === 'vote' || action === 'choose') {
    const optionId = params.get('o');
    return validId(optionId) ? { action, scheduleId, optionId } : undefined;
  }
  return undefined;
}

export const groupScheduleActionInternals = { ID_PATTERN, taipeiDatetime };
