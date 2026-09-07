import type { messagingApi } from '@line/bot-sdk';

import {
  createGroupScheduleChooseData,
  createGroupScheduleDatetimeAction,
  createGroupScheduleFinishData,
  createGroupScheduleRemindData,
  createGroupScheduleVoteData
} from '../actions/groupScheduleActions.js';
import { createGoogleCalendarLink } from '../services/calendarLink.js';
import {
  confirmedGroupScheduleOption,
  countGroupScheduleVotes,
  type GroupSchedule,
  type GroupScheduleOption
} from '../services/groupScheduleStore.js';

export function formatGroupScheduleTime(valueMs: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(valueMs);
}

export function createGroupScheduleStartedMessage(
  schedule: GroupSchedule,
  created: boolean
): messagingApi.TextMessage {
  return {
    type: 'text',
    text: [
      created ? '🗓️ 地點決定了，接著一起選時間！' : '🗓️ 這間店已經有一輪時間投票。',
      '',
      `地點：${schedule.cafe.title}`,
      '每位成員都可以提出時間，最多 5 個；加入後再各投一票。',
      '候選時間必須是 10 分鐘後到 60 天內。'
    ].join('\n'),
    quickReply: {
      items: [
        { type: 'action', action: createGroupScheduleDatetimeAction(schedule.id) },
        { type: 'action', action: { type: 'message', label: '查看時間投票', text: '查看群組時間' } }
      ]
    }
  };
}

export function createGroupScheduleOptionAddedMessage(
  option: GroupScheduleOption,
  created: boolean,
  optionCount: number
): messagingApi.TextMessage {
  return {
    type: 'text',
    text: created
      ? `✅ 已加入候選時間：${formatGroupScheduleTime(option.scheduledAtMs)}（${optionCount}/5）`
      : `這個時間已經在候選清單裡：${formatGroupScheduleTime(option.scheduledAtMs)}`,
    quickReply: {
      items: [{
        type: 'action',
        action: { type: 'message', label: '查看並投票', text: '查看群組時間' }
      }]
    }
  };
}

function optionBubble(
  schedule: GroupSchedule,
  option: GroupScheduleOption,
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
        { type: 'text', text: `時間 ${index + 1}`, size: 'xs', color: '#8A6D3B', weight: 'bold' },
        { type: 'text', text: formatGroupScheduleTime(option.scheduledAtMs), wrap: true, weight: 'bold', size: 'lg' },
        { type: 'text', text: `${votes} 票`, size: 'xl', weight: 'bold', color: votes ? '#B7791F' : '#999999' }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#6F4E37',
        action: {
          type: 'postback',
          label: '投這個時間',
          data: createGroupScheduleVoteData(schedule.id, option.id),
          displayText: `我投 ${formatGroupScheduleTime(option.scheduledAtMs)}`.slice(0, 300)
        }
      }]
    }
  };
}

export function createGroupScheduleMessages(
  schedule: GroupSchedule
): messagingApi.Message[] {
  if (schedule.status === 'confirmed') {
    return [createGroupScheduleConfirmedMessage(schedule, schedule.reminderStatus !== 'none')];
  }
  if (schedule.status === 'tie_break') {
    return createGroupScheduleTieMessages(schedule);
  }
  const activeOptions = schedule.options.filter(
    (option) => option.scheduledAtMs >= Date.now() + 2 * 60_000
  );
  if (activeOptions.length === 0) {
    return [{
      type: 'text',
      text: `「${schedule.cafe.title}」目前還沒有候選時間。每位群組成員都可以提出時間。`,
      quickReply: {
        items: [{ type: 'action', action: createGroupScheduleDatetimeAction(schedule.id) }]
      }
    }];
  }
  const counts = countGroupScheduleVotes(schedule);
  const voterCount = Object.keys(schedule.votes).length;
  return [{
    type: 'flex',
    altText: `群組時間投票（${voterCount} 人已投票）`,
    contents: {
      type: 'carousel',
      contents: activeOptions.map((option, index) =>
        optionBubble(schedule, option, index, counts.get(option.id) ?? 0)
      )
    },
    quickReply: {
      items: [
        { type: 'action', action: createGroupScheduleDatetimeAction(schedule.id) },
        { type: 'action', action: { type: 'message', label: '重新整理票數', text: '查看群組時間' } },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '截止時間投票',
            data: createGroupScheduleFinishData(schedule.id),
            displayText: '截止群組時間投票'
          }
        }
      ]
    }
  }];
}

export function createGroupScheduleVoteRecordedMessages(
  schedule: GroupSchedule,
  option: GroupScheduleOption
): messagingApi.Message[] {
  return [
    { type: 'text', text: `🗳️ 已記下你投給「${formatGroupScheduleTime(option.scheduledAtMs)}」的票。再次投票會改票。` },
    ...createGroupScheduleMessages(schedule)
  ];
}

export function createGroupScheduleOwnerRequiredMessages(
  schedule: GroupSchedule
): messagingApi.Message[] {
  return [
    {
      type: 'text',
      text: [
        '🙋 只有這次選店投票的原發起人可以截止時間投票。',
        '',
        '我已重新顯示目前票數，請原發起人按下方的「截止時間投票」。'
      ].join('\n')
    },
    ...createGroupScheduleMessages(schedule)
  ];
}

export function createGroupScheduleTieMessages(
  schedule: GroupSchedule
): messagingApi.Message[] {
  const tied = schedule.options.filter((option) => schedule.tiedOptionIds.includes(option.id));
  return [{
    type: 'flex',
    altText: '時間投票平手，請發起人決選',
    contents: {
      type: 'carousel',
      contents: tied.map((option, index) => ({
        type: 'bubble',
        size: 'kilo',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: '⚖️ 最高票平手', size: 'sm', color: '#B7791F', weight: 'bold' },
            { type: 'text', text: formatGroupScheduleTime(option.scheduledAtMs), wrap: true, weight: 'bold', size: 'lg' }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'button',
            style: 'primary',
            color: '#6F4E37',
            action: {
              type: 'postback',
              label: '選這個時間',
              data: createGroupScheduleChooseData(schedule.id, option.id),
              displayText: `決選 ${formatGroupScheduleTime(option.scheduledAtMs)}`.slice(0, 300)
            }
          }]
        }
      }))
    }
  }];
}

export function createGroupScheduleConfirmedMessage(
  schedule: GroupSchedule,
  reminderScheduled: boolean
): messagingApi.TextMessage {
  const option = confirmedGroupScheduleOption(schedule);
  if (!option) return { type: 'text', text: '已確認時間，但目前無法讀取日期，請稍後再查看。' };
  const calendarUrl = createGoogleCalendarLink({
    cafe: schedule.cafe,
    startTime: new Date(option.scheduledAtMs).toISOString(),
    durationMinutes: 90
  });
  const reminderText = reminderScheduled && schedule.reminderAtMs
    ? `我會在 ${formatGroupScheduleTime(schedule.reminderAtMs)} 提醒群組。`
    : '群組提醒尚未建立，可以按下方按鈕重試。';
  return {
    type: 'text',
    text: [
      '🎉 地點和時間都決定了！',
      '',
      `地點：${schedule.cafe.title}`,
      `時間：${formatGroupScheduleTime(option.scheduledAtMs)}`,
      `預計停留：90 分鐘`,
      '',
      reminderText
    ].join('\n'),
    quickReply: {
      items: [
        { type: 'action', action: { type: 'uri', label: '加入 Calendar', uri: calendarUrl } },
        { type: 'action', action: { type: 'uri', label: '查看 Google Maps', uri: schedule.cafe.uri } },
        ...(!reminderScheduled ? [{
          type: 'action' as const,
          action: {
            type: 'postback' as const,
            label: '重新設定提醒',
            data: createGroupScheduleRemindData(schedule.id),
            displayText: '重新設定群組提醒'
          }
        }] : [])
      ]
    }
  };
}

export function createGroupScheduleReminderMessage(
  schedule: GroupSchedule
): messagingApi.TextMessage {
  const option = confirmedGroupScheduleOption(schedule);
  return {
    type: 'text',
    text: option
      ? [
          '⏰ 群組咖啡提醒',
          '',
          `大家約在：${schedule.cafe.title}`,
          `時間：${formatGroupScheduleTime(option.scheduledAtMs)}`,
          '',
          '記得確認交通時間，我們咖啡廳見！'
        ].join('\n')
      : '⏰ 群組咖啡時間快到了，記得查看已確認的行程。',
    quickReply: {
      items: [{
        type: 'action',
        action: { type: 'uri', label: '開啟 Google Maps', uri: schedule.cafe.uri }
      }]
    }
  };
}
