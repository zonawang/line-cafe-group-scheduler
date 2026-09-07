import type { messagingApi } from '@line/bot-sdk';

import {
  createGroupFinishAction,
  createGroupVoteData
} from '../actions/groupPlannerActions.js';
import { createGroupScheduleStartData } from '../actions/groupScheduleActions.js';
import {
  countGroupPlanVotes,
  type GroupPlan,
  type GroupPlanCandidate
} from '../services/groupPlanStore.js';

export function createGroupOnlyMessage(): messagingApi.TextMessage {
  return {
    type: 'text',
    text: '「一起選咖啡廳」是群組功能。請先把我加入 LINE 群組，再在群組裡輸入同一句話。'
  };
}

export function createGroupJoinMessage(): messagingApi.TextMessage {
  return {
    type: 'text',
    text: [
      '☕ 謝謝把我加入群組！',
      '',
      '想一起決定聚會的咖啡廳時，輸入「一起選咖啡廳」，我會帶大家選店、選時間並安排群組提醒。'
    ].join('\n')
  };
}

export function createGroupSearchLoadingMessage(): messagingApi.TextMessage {
  return {
    type: 'text',
    text: [
      '☕ 收到位置！正在幫大家找附近的咖啡廳，請稍等一下⋯',
      '',
      '找到後可以把喜歡的店加入群組候選，再一起投票。'
    ].join('\n')
  };
}

export function createGroupPlanStartedMessage(
  alreadyActive = false
): messagingApi.TextMessage {
  return {
    type: 'text',
    text: [
      alreadyActive ? '☕ 這個群組已經有一輪選店進行中。' : '☕ 群組選店開始！',
      '',
      '請傳送聚會地點附近的位置。我會推薦咖啡廳，大家可以把喜歡的店加入候選，再各投一票。',
      '這次投票會保留 24 小時，最多可加入 5 間候選店。'
    ].join('\n'),
    quickReply: {
      items: [{
        type: 'action',
        action: { type: 'location', label: '傳送聚會位置' }
      }]
    }
  };
}

export function createCandidateAddedMessage(
  title: string,
  created: boolean,
  candidateCount: number
): messagingApi.TextMessage {
  return {
    type: 'text',
    text: created
      ? `✅ 已把「${title}」加入群組候選（${candidateCount}/5）。`
      : `「${title}」已經在這次群組候選裡。`,
    quickReply: {
      items: [{
        type: 'action',
        action: { type: 'message', label: '查看並投票', text: '查看群組投票' }
      }]
    }
  };
}

function candidateBubble(
  plan: GroupPlan,
  candidate: GroupPlanCandidate,
  index: number,
  votes: number
): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: `候選 ${index + 1}`, size: 'xs', color: '#8A6D3B', weight: 'bold' },
        { type: 'text', text: candidate.title, wrap: true, weight: 'bold', size: 'lg' },
        {
          type: 'text',
          text: `${votes} 票`,
          size: 'xl',
          weight: 'bold',
          color: votes > 0 ? '#B7791F' : '#999999'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#6F4E37',
          action: {
            type: 'postback',
            label: '投這間',
            data: createGroupVoteData(plan.id, candidate.id),
            displayText: `我投「${candidate.title}」`.slice(0, 300)
          }
        },
        {
          type: 'button',
          action: { type: 'uri', label: '在 Google Maps 查看', uri: candidate.uri }
        }
      ]
    }
  };
}

export function createGroupPlanMessages(plan: GroupPlan): messagingApi.Message[] {
  if (plan.candidates.length === 0) {
    return [{
      type: 'text',
      text: '目前還沒有候選店家。請先傳送位置，再從推薦卡片點「加入群組候選」。',
      quickReply: {
        items: [{ type: 'action', action: { type: 'location', label: '傳送聚會位置' } }]
      }
    }];
  }

  const counts = countGroupPlanVotes(plan);
  const voterCount = Object.keys(plan.votes).length;
  return [{
    type: 'flex',
    altText: `群組咖啡廳投票（${voterCount} 人已投票）`,
    contents: {
      type: 'carousel',
      contents: plan.candidates.map((candidate, index) =>
        candidateBubble(plan, candidate, index, counts.get(candidate.id) ?? 0)
      )
    },
    quickReply: plan.status === 'open'
      ? {
          items: [
            { type: 'action', action: { type: 'message', label: '重新整理票數', text: '查看群組投票' } },
            { type: 'action', action: createGroupFinishAction(plan.id) }
          ]
        }
      : undefined
  }];
}

export function createVoteRecordedMessages(
  plan: GroupPlan,
  candidateTitle: string
): messagingApi.Message[] {
  return [
    { type: 'text', text: `🗳️ 已記下你投給「${candidateTitle}」的票。再次投票會改成新的選擇。` },
    ...createGroupPlanMessages(plan)
  ];
}

export function createGroupPlanOwnerRequiredMessages(
  plan: GroupPlan
): messagingApi.Message[] {
  return [
    {
      type: 'text',
      text: [
        '🙋 只有這次選店投票的發起人可以截止投票。',
        '',
        '我已重新顯示目前票數，請原發起人按下方的「截止投票」。'
      ].join('\n')
    },
    ...createGroupPlanMessages(plan)
  ];
}

export function createGroupPlanFinalMessage(plan: GroupPlan): messagingApi.TextMessage {
  const counts = countGroupPlanVotes(plan);
  const highest = Math.max(0, ...counts.values());
  const winners = plan.candidates.filter(
    (candidate) => (counts.get(candidate.id) ?? 0) === highest
  );
  const winner = highest > 0 && winners.length === 1 ? winners[0] : undefined;
  const result = highest === 0
    ? '這次還沒有人投票，因此沒有最高票店家。'
    : winner
      ? `最高票是「${winner.title}」，共 ${highest} 票！`
      : `最高票平手：${winners.map((candidate) => `「${candidate.title}」`).join('、')}，各 ${highest} 票。`;
  return {
    type: 'text',
    text: `🏁 群組投票已截止\n\n${result}\n\n${winner ? '接著按「接著一起選時間」，把聚會時間也定下來。' : '想再選一次，可以輸入「一起選咖啡廳」。'}`,
    quickReply: winner
      ? {
          items: [
            {
              type: 'action',
              action: {
                type: 'postback',
                label: '接著一起選時間',
                data: createGroupScheduleStartData(plan.id),
                displayText: '接著一起選時間'
              }
            },
            {
              type: 'action',
              action: { type: 'uri', label: '查看最高票店家', uri: winner.uri }
            }
          ]
        }
      : undefined
  };
}
