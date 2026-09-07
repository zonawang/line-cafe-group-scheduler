# LINE Cafe Group Scheduler

LINE 群組不只一起投票選咖啡廳，也能提出候選時間、每人投一票、處理平手、加入 Google Calendar，並在聚會前收到群組提醒。

這個版本延續 [`line-cafe-group-planner`](https://github.com/zonawang/line-cafe-group-planner) 的完整 Cafe Bot 與群組選店流程。

## 完整使用流程

```text
在 LINE 群組傳送位置
        ↓
加入咖啡廳候選並投票
        ↓
發起人截止店家投票
        ↓
按「接著一起選時間」
        ↓
成員提出最多 5 個日期時間
        ↓
每人投 1 票，可隨時改票
        ↓
發起人截止；平手時進行決選
        ↓
產生 Calendar 連結並排定群組提醒
```

群組也可以輸入以下指令：

```text
開始選時間
查看群組時間
```

## 時間投票規則

- 只有咖啡廳投票已有「單一且至少一票」的最高票店家，才能開始選時間。
- 原本的群組選店發起人同時是時間投票發起人。
- 每位成員都能使用 LINE Datetime Picker 提出時間。
- 時間必須在 10 分鐘後到 60 天內，最多保留 5 個有效候選。
- 過期候選會在新增時間時自動清理，不會一直占用名額。
- 每位 LINE 使用者只有一張有效票，再次投票會改票。
- 只有發起人可以截止；至少要有一個有效候選和一張票。
- 單一最高票會直接確認；平手時只留下最高票時段，由發起人決選。
- 每個 postback 都綁定 schedule ID、group ID 與 actor，拒絕舊輪次或跨群組操作。

## 確認後的行程

時間確認後，Bot 會在群組公布：

- 咖啡廳名稱。
- 台北時區的完整日期與時間。
- 預設 90 分鐘行程。
- Google Calendar 預填連結。
- Google Maps 入口。
- 預計發送群組提醒的時間。

預設提前 60 分鐘提醒。若聚會已在一小時內，提醒時間會改成「目前到聚會之間的一半」，確保 Cloud Task 仍排在未來。例如 30 分鐘後聚會，會在 15 分鐘後提醒。

## 群組提醒的可靠性

提醒由 Google Cloud Tasks 保存，不依賴 Cloud Run process 記憶體：

```text
時間投票確認
      ↓
建立固定名稱的 Cloud Task
      ↓
到點呼叫 /tasks/group-reminders
      ↓
驗證 X-Cafe-Reminder-Secret
      ↓
Firestore Transaction 取得 delivery lease
      ↓
LINE Push Message 提醒整個群組
```

- Task 名稱固定使用 schedule ID，重試建立不會產生第二個提醒。
- Firestore 使用 `scheduled → sending → sent` 狀態與五分鐘 lease。
- LINE 推播成功後才標記 `sent`；失敗則釋放 lease，讓 Cloud Tasks 重試。
- 已送出的 task 再次呼叫會回 `204`，不會重複打擾群組。
- 若 Task 建立失敗，行程仍會保留，確認訊息提供「重新設定提醒」。
- 尚未發送提醒的未來行程不會被新一輪時間投票覆蓋。

## 資料模型與隱私

Firestore 的時間投票保存：

- LINE group ID 與發起人 user ID。
- 對應的 group plan ID 與最高票咖啡廳。
- 候選時間、提出者 user ID 與每位成員目前的票。
- 確認時間、提醒 task、狀態與 delivery lease。

不會為了顯示投票結果額外取得或保存成員名稱與頭像。

## 既有功能

- Gemini + Google Maps Grounding 附近咖啡廳推薦。
- 個人偏好、換一批與更適合工作。
- 個人 Datetime Picker、Google Calendar 與造訪後回訪。
- 咖啡足跡與想去清單。
- 拍菜單後使用 Gemini 推薦可見飲品。
- 群組咖啡廳候選、投票、改票與結果公布。
- LINE Rich Menu。

## 本機設定

需求：Node.js 20 以上、LINE Messaging API channel，以及已啟用 Vertex AI、Firestore 與 Cloud Tasks 的 Google Cloud 專案。

```bash
cp .env.example .env
npm install
npm run dev
```

群組時間功能新增的環境變數：

```env
FIRESTORE_GROUP_SCHEDULES_COLLECTION=cafe-group-schedules
GROUP_REMINDER_CALLBACK_URL=https://YOUR_SERVICE_URL/tasks/group-reminders
GROUP_REMINDER_LEAD_MINUTES=60
```

群組提醒沿用既有的 `REMINDER_TASK_SECRET`、Cloud Tasks location 與 queue。

本機呼叫 Google Cloud 服務前，先建立 Application Default Credentials：

```bash
gcloud auth application-default login
```

## 驗證

```bash
npm run typecheck
npm test
```

目前共有 83 項測試，涵蓋既有 Cafe Bot 與新增的時間 action、時區範圍、單一勝者、改票、平手決選、Calendar 卡片、提醒計算及 Cloud Task payload。

## Cloud Run 部署

```bash
gcloud run deploy line-cafe-group-scheduler \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --service-account line-cafe-group-scheduler@YOUR_PROJECT.iam.gserviceaccount.com \
  --env-vars-file cloud-run-env.yaml
```

部署後確認：

```text
GET /health
POST /webhook
POST /tasks/group-reminders
```

通過 health check、簽章 request 與 LINE Webhook Verify 後，再將正式 webhook 切換到新服務。

## 已知限制

- 每個群組同時只保留一筆尚未到來的確認行程。
- 時間候選固定使用台北時區。
- 行程長度目前固定為 90 分鐘。
- 咖啡廳投票平手時需先重新決定店家，才會進入時間投票。
- Calendar 連結由每位成員自行加入，Bot 不會直接寫入個人 Google Calendar。

## 官方文件

- [LINE Messaging API：Datetime picker action](https://developers.line.biz/en/reference/messaging-api/#datetime-picker-action)
- [LINE Messaging API：Group chats](https://developers.line.biz/en/docs/messaging-api/group-chats/)
- [LINE Messaging API：Postback action](https://developers.line.biz/en/reference/messaging-api/#postback-action)
- [LINE Messaging API：Send push message](https://developers.line.biz/en/reference/messaging-api/#send-push-message)
- [Google Cloud Tasks：Create HTTP target tasks](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
