import type { messagingApi } from '@line/bot-sdk';

import {
  createGroupOnlyMessage,
  createGroupPlanFinalMessage,
  createGroupPlanMessages,
  createGroupPlanStartedMessage
} from '../messages/groupPlannerMessages.js';
import {
  createGroupPlan,
  getGroupPlan,
  GroupPlanError
} from '../services/groupPlanStore.js';

const START_COMMANDS = new Set(['一起選咖啡廳', '開始群組投票', '群組選店']);
const VIEW_COMMANDS = new Set(['查看群組投票', '群組投票', '目前票數']);

export async function handleGroupPlannerText(input: {
  actorId: string;
  conversationId: string;
  sourceType: 'user' | 'group' | 'room';
  text: string;
}): Promise<messagingApi.Message[] | undefined> {
  const text = input.text.trim();
  const isStart = START_COMMANDS.has(text);
  const isView = VIEW_COMMANDS.has(text);
  if (!isStart && !isView) return undefined;
  if (input.sourceType !== 'group') return [createGroupOnlyMessage()];
  if (!input.actorId || !input.conversationId) {
    return [{ type: 'text', text: '目前無法確認群組成員，請稍後再試。' }];
  }

  if (isStart) {
    const result = await createGroupPlan({
      conversationId: input.conversationId,
      creatorId: input.actorId
    });
    if (!result.created && result.plan.candidates.length > 0) {
      return createGroupPlanMessages(result.plan);
    }
    return [createGroupPlanStartedMessage(!result.created)];
  }

  try {
    const plan = await getGroupPlan(input.conversationId);
    return plan.status === 'finalized'
      ? [createGroupPlanFinalMessage(plan)]
      : createGroupPlanMessages(plan);
  } catch (error) {
    if (error instanceof GroupPlanError) {
      return [{
        type: 'text',
        text: error.code === 'expired'
          ? '上一輪群組投票已超過 24 小時。輸入「一起選咖啡廳」重新開始。'
          : '目前沒有進行中的群組投票。輸入「一起選咖啡廳」開始。'
      }];
    }
    throw error;
  }
}
