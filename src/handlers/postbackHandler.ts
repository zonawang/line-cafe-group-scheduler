import type { messagingApi, WebhookEvent } from '@line/bot-sdk';

import {
  cafeDatetimeToIso,
  formatCafeDatetime,
  isCafeDatetimePostbackData,
  parseCafeDatetimePickerData
} from '../actions/cafeDatetimePickerActions.js';
import { parseCafePostbackData } from '../actions/cafePostbackActions.js';
import { parseFollowUpPostbackData } from '../actions/followUpPostbackActions.js';
import { parsePreferencePostbackData } from '../actions/preferencePostbackActions.js';
import { parseJourneyPostbackData } from '../actions/journeyPostbackActions.js';
import {
  parseWishlistDatetimePickerData,
  parseWishlistPostbackData
} from '../actions/wishlistActions.js';
import { parseGroupPlannerPostbackData } from '../actions/groupPlannerActions.js';
import { parseGroupSchedulePostbackData } from '../actions/groupScheduleActions.js';
import {
  createCafeDatetimeResultMessage,
  createCafeResultMessages,
  createPreferenceCompletedMessage
} from '../messages/cafeMessages.js';
import {
  createJourneyCompletedMessage,
  createJourneyRatingMessage,
  createJourneyTagMessage
} from '../messages/journeyMessages.js';
import { createFollowUpSkippedMessage } from '../messages/followUpMessages.js';
import {
  createWishlistRemovedMessage,
  createWishlistSavedMessage
} from '../messages/wishlistMessages.js';
import {
  createCandidateAddedMessage,
  createGroupPlanFinalMessage,
  createGroupPlanOwnerRequiredMessages,
  createVoteRecordedMessages
} from '../messages/groupPlannerMessages.js';
import {
  createGroupScheduleConfirmedMessage,
  createGroupScheduleMessages,
  createGroupScheduleOptionAddedMessage,
  createGroupScheduleOwnerRequiredMessages,
  createGroupScheduleStartedMessage,
  createGroupScheduleTieMessages,
  createGroupScheduleVoteRecordedMessages
} from '../messages/groupScheduleMessages.js';
import { findNearbyCafes } from '../services/geminiMaps.js';
import { createGoogleCalendarLink } from '../services/calendarLink.js';
import {
  cancelPendingPreferenceAction,
  executePendingPreferenceAction,
  PreferenceActionError
} from '../services/preferenceStore.js';
import { lineClient } from '../services/lineClient.js';
import {
  beginPlannedVisitFeedback,
  cancelPlannedVisit,
  PlannedVisitError
} from '../services/plannedVisitStore.js';
import {
  formatFollowUpDateTime,
  scheduleCafeFollowUp
} from '../services/reminderScheduler.js';
import {
  addJourneyTag,
  completeJourney,
  createJourneyDraft,
  getJourneyRecommendationProfile,
  JourneyError,
  rateJourney
} from '../services/journeyStore.js';
import {
  claimSearchSession,
  completeSearchSession,
  getSearchSession,
  getSearchSessionForConversation,
  releaseSearchSession,
  SearchSessionError,
  type CafeSearchPreference
} from '../services/searchSessionStore.js';
import { getActorId, getConversationId } from '../utils/lineEvent.js';
import { logger } from '../utils/logger.js';
import {
  getWishlistItem,
  removeWishlistItem,
  saveWishlistItem,
  WishlistError
} from '../services/wishlistStore.js';
import {
  addGroupCandidate,
  finalizeGroupPlan,
  getGroupPlan,
  GroupPlanError,
  voteForGroupCandidate
} from '../services/groupPlanStore.js';
import {
  addGroupScheduleOption,
  chooseGroupScheduleTie,
  createGroupSchedule,
  finalizeGroupSchedule,
  getGroupSchedule,
  GroupScheduleError,
  voteForGroupScheduleOption
} from '../services/groupScheduleStore.js';
import { ensureGroupReminder } from '../services/groupReminderScheduler.js';
import { groupScheduleErrorText } from './groupScheduleTextHandler.js';

function errorText(error: unknown): string {
  if (error instanceof GroupScheduleError) return groupScheduleErrorText(error);
  if (error instanceof GroupPlanError) {
    switch (error.code) {
      case 'forbidden':
        return '只有這次投票的發起人可以截止投票。';
      case 'full':
        return '候選店家已滿 5 間，請先進行投票。';
      case 'no_candidates':
        return '目前還沒有候選店家，請先傳送位置並加入候選。';
      case 'finalized':
        return '這次群組投票已經截止。輸入「一起選咖啡廳」可以開新的一輪。';
      case 'stale':
        return '這是上一輪投票的按鈕，請輸入「查看群組投票」取得最新內容。';
      case 'candidate_missing':
        return '這間店已不在目前的候選清單裡。';
      case 'expired':
        return '這次群組投票已超過 24 小時，請重新開始。';
      case 'not_found':
        return '目前沒有進行中的群組投票。請輸入「一起選咖啡廳」。';
    }
  }
  if (error instanceof PreferenceActionError) {
    if (error.code === 'completed') return '這個偏好操作已經執行過了。';
    if (error.code === 'forbidden') return '這個偏好操作不屬於你，無法執行。';
    return '這個偏好確認操作已過期，請重新下指令。';
  }
  if (error instanceof SearchSessionError) {
    switch (error.code) {
      case 'busy':
        return '上一個搜尋還在進行中，請稍等結果出現。';
      case 'forbidden':
        return '這個搜尋按鈕屬於其他使用者，請重新傳送你的位置。';
      case 'expired':
      case 'not_found':
        return '這次搜尋已經過期，請重新傳送位置。';
    }
  }
  if (error instanceof JourneyError) {
    switch (error.code) {
      case 'forbidden':
        return '這個咖啡足跡不屬於你，無法操作。';
      case 'completed':
        return '這筆咖啡足跡已經完成紀錄了。';
      case 'incomplete':
        return '請先替這次體驗評分，再完成紀錄。';
      case 'expired':
      case 'not_found':
        return '這次足跡紀錄已過期，請回到推薦卡片重新操作。';
    }
  }
  if (error instanceof PlannedVisitError) {
    if (error.code === 'forbidden') return '這個提醒不屬於你，無法操作。';
    if (error.code === 'completed') return '這個提醒已經處理過了。';
    return '這個咖啡行程提醒已經無法使用。';
  }
  if (error instanceof WishlistError) {
    if (error.code === 'forbidden') return '這個收藏不屬於你，無法操作。';
    return '這筆收藏已不存在，請重新查看想去清單。';
  }

  return '目前無法更新咖啡廳推薦，請稍後再試一次。';
}

async function confirmedScheduleMessage(
  schedule: Awaited<ReturnType<typeof getGroupSchedule>>
): Promise<messagingApi.TextMessage> {
  try {
    const withReminder = await ensureGroupReminder(schedule);
    return createGroupScheduleConfirmedMessage(withReminder, true);
  } catch (error) {
    logger.error('Failed to schedule group reminder', {
      scheduleId: schedule.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return createGroupScheduleConfirmedMessage(schedule, false);
  }
}

function retryMessage(text: string): messagingApi.TextMessage {
  return {
    type: 'text',
    text,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'location',
            label: '重新傳送位置'
          }
        }
      ]
    }
  };
}

export async function handlePostbackEvent(
  event: Extract<WebhookEvent, { type: 'postback' }>
): Promise<void> {
  const groupSchedulePostback = parseGroupSchedulePostbackData(event.postback.data);
  if (groupSchedulePostback) {
    const actorId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (event.source.type !== 'group' || !actorId || !conversationId) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '這個時間按鈕只能在原本的 LINE 群組使用。' }]
      });
      return;
    }

    try {
      if (groupSchedulePostback.action === 'start') {
        const plan = await getGroupPlan(conversationId);
        if (plan.id !== groupSchedulePostback.planId) {
          throw new GroupScheduleError('stale');
        }
        const result = await createGroupSchedule({ plan, conversationId, actorId });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: result.created || result.schedule.options.length === 0
            ? [createGroupScheduleStartedMessage(result.schedule, result.created)]
            : createGroupScheduleMessages(result.schedule)
        });
        return;
      }

      if (groupSchedulePostback.action === 'add') {
        const params = event.postback.params;
        const selected = params && 'datetime' in params ? params.datetime : undefined;
        const iso = selected ? cafeDatetimeToIso(selected) : undefined;
        if (!iso) throw new GroupScheduleError('time_invalid');
        const result = await addGroupScheduleOption({
          conversationId,
          scheduleId: groupSchedulePostback.scheduleId,
          proposerId: actorId,
          scheduledAtMs: Date.parse(iso)
        });
        const option = result.schedule.options.find(
          (candidate) => candidate.scheduledAtMs === Date.parse(iso)
        );
        if (!option) throw new GroupScheduleError('option_missing');
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createGroupScheduleOptionAddedMessage(
            option,
            result.created,
            result.schedule.options.length
          )]
        });
        return;
      }

      if (groupSchedulePostback.action === 'vote') {
        const schedule = await voteForGroupScheduleOption({
          conversationId,
          scheduleId: groupSchedulePostback.scheduleId,
          voterId: actorId,
          optionId: groupSchedulePostback.optionId
        });
        const option = schedule.options.find(
          (candidate) => candidate.id === groupSchedulePostback.optionId
        );
        if (!option) throw new GroupScheduleError('option_missing');
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: createGroupScheduleVoteRecordedMessages(schedule, option)
        });
        return;
      }

      if (groupSchedulePostback.action === 'finish') {
        const schedule = await finalizeGroupSchedule({
          conversationId,
          scheduleId: groupSchedulePostback.scheduleId,
          actorId
        });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: schedule.status === 'tie_break'
            ? createGroupScheduleTieMessages(schedule)
            : [await confirmedScheduleMessage(schedule)]
        });
        return;
      }

      if (groupSchedulePostback.action === 'choose') {
        const schedule = await chooseGroupScheduleTie({
          conversationId,
          scheduleId: groupSchedulePostback.scheduleId,
          actorId,
          optionId: groupSchedulePostback.optionId
        });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [await confirmedScheduleMessage(schedule)]
        });
        return;
      }

      const schedule = await getGroupSchedule(
        conversationId,
        groupSchedulePostback.scheduleId
      );
      const withReminder = await ensureGroupReminder(schedule);
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [createGroupScheduleConfirmedMessage(withReminder, true)]
      });
    } catch (error) {
      if (
        groupSchedulePostback.action === 'finish'
        && error instanceof GroupScheduleError
        && error.code === 'forbidden'
      ) {
        try {
          const schedule = await getGroupSchedule(
            conversationId,
            groupSchedulePostback.scheduleId
          );
          await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: createGroupScheduleOwnerRequiredMessages(schedule)
          });
          return;
        } catch {
          // Fall through to the original error when the latest vote cannot be loaded.
        }
      }
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: errorText(error) }]
      });
    }
    return;
  }

  const groupPlannerPostback = parseGroupPlannerPostbackData(event.postback.data);
  if (groupPlannerPostback) {
    const actorId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (event.source.type !== 'group' || !actorId || !conversationId) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '這個按鈕只能在原本的 LINE 群組中使用。' }]
      });
      return;
    }

    try {
      if (groupPlannerPostback.action === 'add') {
        const session = await getSearchSessionForConversation(
          groupPlannerPostback.sessionId,
          conversationId
        );
        const cafe = session.cafes[groupPlannerPostback.cafeNumber - 1];
        if (!cafe) throw new SearchSessionError('not_found');
        const result = await addGroupCandidate({
          conversationId,
          planId: groupPlannerPostback.planId,
          cafe
        });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createCandidateAddedMessage(
            cafe.title,
            result.created,
            result.plan.candidates.length
          )]
        });
        return;
      }

      if (groupPlannerPostback.action === 'vote') {
        const plan = await voteForGroupCandidate({
          conversationId,
          planId: groupPlannerPostback.planId,
          voterId: actorId,
          candidateId: groupPlannerPostback.candidateId
        });
        const candidate = plan.candidates.find(
          (item) => item.id === groupPlannerPostback.candidateId
        );
        if (!candidate) throw new GroupPlanError('candidate_missing');
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: createVoteRecordedMessages(plan, candidate.title)
        });
        return;
      }

      const plan = await finalizeGroupPlan({
        conversationId,
        planId: groupPlannerPostback.planId,
        actorId
      });
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [createGroupPlanFinalMessage(plan)]
      });
    } catch (error) {
      if (
        groupPlannerPostback.action === 'finish'
        && error instanceof GroupPlanError
        && error.code === 'forbidden'
      ) {
        try {
          const plan = await getGroupPlan(conversationId);
          if (plan.id !== groupPlannerPostback.planId) throw new GroupPlanError('stale');
          await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: createGroupPlanOwnerRequiredMessages(plan)
          });
          return;
        } catch {
          // Fall through to the original error when the latest vote cannot be loaded.
        }
      }
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: errorText(error) }]
      });
    }
    return;
  }

  const wishlistDatetime = parseWishlistDatetimePickerData(event.postback.data);
  if (wishlistDatetime) {
    const postbackParams = event.postback.params;
    const selectedDatetime =
      postbackParams && 'datetime' in postbackParams
        ? postbackParams.datetime
        : undefined;
    const formattedDatetime = selectedDatetime
      ? formatCafeDatetime(selectedDatetime)
      : undefined;
    const ownerId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    try {
      if (!selectedDatetime || !formattedDatetime || !ownerId || !conversationId) {
        throw new WishlistError('not_found');
      }
      const item = await getWishlistItem(wishlistDatetime.wishlistItemId, ownerId);
      const startTime = cafeDatetimeToIso(selectedDatetime);
      if (!startTime || Date.parse(startTime) <= Date.now()) {
        throw new WishlistError('not_found');
      }
      const plannedVisit = await scheduleCafeFollowUp({
        ownerId,
        conversationId,
        cafe: item.cafe,
        scheduledAtMs: Date.parse(startTime)
      });
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [createCafeDatetimeResultMessage(
          item.cafe.title,
          formattedDatetime,
          createGoogleCalendarLink({ cafe: item.cafe, startTime }),
          formatFollowUpDateTime(plannedVisit.remindAtMs)
        )]
      });
    } catch (error) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: error instanceof WishlistError
            ? errorText(error)
            : '目前無法從想去清單安排時間，請稍後再試。'
        }]
      });
    }
    return;
  }

  if (isCafeDatetimePostbackData(event.postback.data)) {
    const postbackParams = event.postback.params;
    const selectedDatetime =
      postbackParams && 'datetime' in postbackParams
        ? postbackParams.datetime
        : undefined;
    const formattedDatetime = selectedDatetime
      ? formatCafeDatetime(selectedDatetime)
      : undefined;

    const selection = parseCafeDatetimePickerData(event.postback.data);
    const ownerId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (selection && selectedDatetime && formattedDatetime && ownerId && conversationId) {
      try {
        const session = await getSearchSession(selection.sessionId, ownerId, conversationId);
        const cafe = session.cafes[selection.cafeNumber - 1];
        const startTime = cafeDatetimeToIso(selectedDatetime);
        if (!cafe || !startTime || Date.parse(startTime) <= Date.now()) {
          throw new SearchSessionError('expired');
        }
        const scheduledAtMs = Date.parse(startTime);
        const plannedVisit = await scheduleCafeFollowUp({
          ownerId,
          conversationId,
          cafe,
          scheduledAtMs
        });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createCafeDatetimeResultMessage(
            cafe.title,
            formattedDatetime,
            createGoogleCalendarLink({ cafe, startTime }),
            formatFollowUpDateTime(plannedVisit.remindAtMs)
          )]
        });
        logger.info('Cafe datetime selected', {
          webhookEventId: event.webhookEventId,
          valid: true,
          cafeNumber: selection.cafeNumber
        });
        return;
      } catch (error) {
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [retryMessage(
            error instanceof SearchSessionError
              ? errorText(error)
              : '目前無法建立造訪提醒，請稍後再選一次時間。'
          )]
        });
        return;
      }
    }

    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [createCafeDatetimeResultMessage(formattedDatetime)]
    });

    logger.info('Cafe datetime selected', {
      webhookEventId: event.webhookEventId,
      valid: Boolean(formattedDatetime)
    });
    return;
  }

  const wishlistPostback = parseWishlistPostbackData(event.postback.data);
  if (wishlistPostback) {
    const ownerId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (!ownerId || !conversationId) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '目前無法確認操作來源，請稍後再試。' }]
      });
      return;
    }
    try {
      if (wishlistPostback.action === 'add') {
        const session = await getSearchSession(
          wishlistPostback.sessionId,
          ownerId,
          conversationId
        );
        const cafe = session.cafes[wishlistPostback.cafeNumber - 1];
        if (!cafe) throw new SearchSessionError('not_found');
        const saved = await saveWishlistItem({ ownerId, cafe });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createWishlistSavedMessage(cafe.title, saved.created)]
        });
        return;
      }

      const removed = await removeWishlistItem(
        wishlistPostback.wishlistItemId,
        ownerId
      );
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [createWishlistRemovedMessage(removed.cafe.title)]
      });
    } catch (error) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: errorText(error) }]
      });
    }
    return;
  }

  const followUpPostback = parseFollowUpPostbackData(event.postback.data);
  if (followUpPostback) {
    const ownerId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (!ownerId || !conversationId) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '目前無法確認操作來源，請稍後再試。' }]
      });
      return;
    }

    try {
      if (followUpPostback.action === 'skip') {
        const visit = await cancelPlannedVisit(
          followUpPostback.plannedVisitId,
          ownerId,
          conversationId
        );
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createFollowUpSkippedMessage(visit.cafe.title)]
        });
        return;
      }

      const visit = await beginPlannedVisitFeedback(
        followUpPostback.plannedVisitId,
        ownerId,
        conversationId
      );
      const journey = await createJourneyDraft({
        id: visit.id,
        ownerId,
        conversationId,
        cafe: visit.cafe,
        visitedAtMs: visit.scheduledAtMs
      });
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [createJourneyRatingMessage(journey)]
      });
    } catch (error) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: errorText(error) }]
      });
    }
    return;
  }

  const preferencePostback = parsePreferencePostbackData(event.postback.data);
  if (preferencePostback) {
    const ownerId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (!ownerId || !conversationId) {
      await lineClient.replyMessage({ replyToken: event.replyToken, messages: [retryMessage('目前無法確認操作來源，請稍後再試。')] });
      return;
    }
    try {
      if (preferencePostback.action === 'cancel') {
        await cancelPendingPreferenceAction(preferencePostback.id, ownerId, conversationId);
        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '已取消這次偏好操作。' }] });
      } else {
        const action = await executePendingPreferenceAction(preferencePostback.id, ownerId, conversationId);
        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [createPreferenceCompletedMessage(action)] });
      }
    } catch (error) {
      await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: errorText(error) }] });
    }
    return;
  }

  const journeyPostback = parseJourneyPostbackData(event.postback.data);
  if (journeyPostback) {
    const ownerId = getActorId(event.source);
    const conversationId = getConversationId(event.source);
    if (!ownerId || !conversationId) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '目前無法確認操作來源，請稍後再試。' }]
      });
      return;
    }

    try {
      if (journeyPostback.action === 'visit') {
        const session = await getSearchSession(
          journeyPostback.sessionId,
          ownerId,
          conversationId
        );
        const cafe = session.cafes[journeyPostback.cafeNumber - 1];
        if (!cafe) throw new SearchSessionError('not_found');
        const journey = await createJourneyDraft({ ownerId, conversationId, cafe });
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createJourneyRatingMessage(journey)]
        });
        return;
      }

      if (journeyPostback.action === 'rate') {
        const journey = await rateJourney(
          journeyPostback.journeyId,
          ownerId,
          conversationId,
          journeyPostback.rating
        );
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createJourneyTagMessage(journey)]
        });
        return;
      }

      if (journeyPostback.action === 'tag') {
        const journey = await addJourneyTag(
          journeyPostback.journeyId,
          ownerId,
          conversationId,
          journeyPostback.tag
        );
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [createJourneyTagMessage(journey)]
        });
        return;
      }

      const journey = await completeJourney(
        journeyPostback.journeyId,
        ownerId,
        conversationId
      );
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [createJourneyCompletedMessage(journey)]
      });
    } catch (error) {
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: errorText(error) }]
      });
    }
    return;
  }

  const parsed = parseCafePostbackData(event.postback.data);

  if (!parsed) {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [retryMessage('無法辨識這個操作，請重新傳送位置。')]
    });
    return;
  }

  const ownerId = getActorId(event.source);
  const conversationId = getConversationId(event.source);

  if (!ownerId || !conversationId) {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [retryMessage('目前無法確認操作來源，請重新傳送位置。')]
    });
    return;
  }

  let sessionClaimed = false;

  try {
    const session = await claimSearchSession(
      parsed.sessionId,
      ownerId,
      conversationId
    );
    sessionClaimed = true;

    try {
      await lineClient.showLoadingAnimation({
        chatId: conversationId,
        loadingSeconds: 60
      });
    } catch (error) {
      logger.error('Postback loading animation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const preference: CafeSearchPreference =
      parsed.action === 'work_friendly'
        ? 'work_friendly'
        : session.preference;
    const journeyProfile = await getJourneyRecommendationProfile(ownerId);
    const result = await findNearbyCafes(session.latitude, session.longitude, {
      preference,
      excludeNames: Array.from(new Set([
        ...session.previousCafeNames,
        ...journeyProfile.avoidCafeNames
      ])),
      preferences: session.preferences,
      journeyPreferences: journeyProfile.preferences
    });

    await completeSearchSession(
      session.id,
      preference,
      result.sources.map((source) => source.title),
      result.sources
    );
    sessionClaimed = false;

    let groupPlanId: string | undefined;
    if (event.source.type === 'group') {
      try {
        const groupPlan = await getGroupPlan(conversationId);
        groupPlanId = groupPlan.status === 'open' ? groupPlan.id : undefined;
      } catch (groupPlanError) {
        if (!(groupPlanError instanceof GroupPlanError)) throw groupPlanError;
      }
    }

    await lineClient.pushMessage({
      to: conversationId,
      messages: createCafeResultMessages(result, session.id, groupPlanId)
    });

    logger.info('Cafe postback search reply sent', {
      action: parsed.action,
      sessionId: session.id,
      sourceCount: result.sources.length
    });
  } catch (error) {
    if (sessionClaimed) {
      try {
        await releaseSearchSession(parsed.sessionId);
      } catch (releaseError) {
        logger.error('Failed to release cafe search session lock', {
          error:
            releaseError instanceof Error
              ? releaseError.message
              : String(releaseError)
        });
      }
    }

    logger.error('Cafe postback search failed', {
      action: parsed.action,
      sessionId: parsed.sessionId,
      error: error instanceof Error ? error.message : String(error)
    });

    await lineClient.pushMessage({
      to: conversationId,
      messages: [retryMessage(errorText(error))]
    });
  }
}
