import type { messagingApi } from '@line/bot-sdk';

import {
  createGroupScheduleMessages,
  createGroupScheduleStartedMessage
} from '../messages/groupScheduleMessages.js';
import {
  createGroupSchedule,
  getGroupSchedule,
  GroupScheduleError
} from '../services/groupScheduleStore.js';
import { getGroupPlan } from '../services/groupPlanStore.js';

const START_COMMANDS = new Set(['開始選時間', '一起選時間', '安排群組時間']);
const VIEW_COMMANDS = new Set(['查看群組時間', '查看時間投票', '群組時間投票']);

export function groupScheduleErrorText(error: unknown): string {
  if (!(error instanceof GroupScheduleError)) {
    return '目前無法更新群組時間，請稍後再試。';
  }
  switch (error.code) {
    case 'not_found':
      return '目前沒有時間投票。請先完成咖啡廳投票，再按「接著一起選時間」。';
    case 'expired':
      return '這輪時間投票已過期，請重新開始群組選店。';
    case 'stale':
      return '這是上一輪時間投票的按鈕，請輸入「查看群組時間」取得最新內容。';
    case 'forbidden':
      return '只有原本的群組選店發起人可以開始、截止或決選時間。';
    case 'cafe_vote_required':
      return '請先完成咖啡廳投票，而且至少要有一間店得到票。';
    case 'cafe_vote_tied':
      return '咖啡廳投票目前平手，請先決定店家，再開始選時間。';
    case 'active_schedule_exists':
      return '這個群組已經有一筆尚未到來的確認行程。請先完成目前行程，再建立下一筆。';
    case 'full':
      return '候選時間已滿 5 個，請開始投票。';
    case 'no_options':
      return '目前還沒有候選時間，請先提出至少一個時間。';
    case 'no_votes':
      return '目前還沒有人投票，至少一人投票後才能截止。';
    case 'option_missing':
      return '這個時間已不在目前候選清單裡。';
    case 'time_invalid':
      return '請選擇 10 分鐘後到 60 天內的時間。';
    case 'already_confirmed':
      return '這次群組時間已經確認。';
    case 'not_collecting':
      return '時間投票已截止，不能再新增時間或改票。';
    case 'not_tied':
      return '這次時間投票目前不需要決選。';
    case 'not_ready':
      return '群組提醒尚未到發送時間。';
    case 'busy':
      return '群組提醒正在處理中，請稍後再試。';
  }
}

export async function handleGroupScheduleText(input: {
  actorId: string;
  conversationId: string;
  sourceType: 'user' | 'group' | 'room';
  text: string;
}): Promise<messagingApi.Message[] | undefined> {
  const text = input.text.trim();
  const isStart = START_COMMANDS.has(text);
  const isView = VIEW_COMMANDS.has(text);
  if (!isStart && !isView) return undefined;
  if (input.sourceType !== 'group') {
    return [{ type: 'text', text: '時間投票是群組功能，請到原本的 LINE 群組使用。' }];
  }
  if (!input.actorId || !input.conversationId) {
    return [{ type: 'text', text: '目前無法確認群組成員，請稍後再試。' }];
  }
  try {
    if (isStart) {
      const result = await createGroupSchedule({
        plan: await getGroupPlan(input.conversationId),
        conversationId: input.conversationId,
        actorId: input.actorId
      });
      return result.created || result.schedule.options.length === 0
        ? [createGroupScheduleStartedMessage(result.schedule, result.created)]
        : createGroupScheduleMessages(result.schedule);
    }
    return createGroupScheduleMessages(
      await getGroupSchedule(input.conversationId)
    );
  } catch (error) {
    return [{ type: 'text', text: groupScheduleErrorText(error) }];
  }
}
