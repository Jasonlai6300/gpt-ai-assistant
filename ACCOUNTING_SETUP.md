# 個人 LINE 記帳｜Vercel＋Neon 更新版

此套更新檔適用於 Jasonlai6300/gpt-ai-assistant 原專案。會替換舊 AI 聊天入口，改成個人收支記帳；舊檔案可以保留但不再載入。沒有 OpenAI API 使用費。Vercel、LINE、Neon 的用量與收費依各自方案。

## 目前狀態
- 已完成 Node.js 24 程式與本機自動測試。
- 尚未上傳你的 GitHub、部署到 Vercel，或實際連線你的 Neon／LINE。
- ZIP 不含你的金鑰；不用把金鑰貼給 ChatGPT。

## 1. 一次上傳更新檔
1. 解壓縮本 ZIP。
2. 開啟 https://github.com/Jasonlai6300/gpt-ai-assistant ，確認分支為 main。
3. 按 Add file → Upload files。
4. 將解壓後的 api 資料夾、accounting 資料夾、package.json、package-lock.json、vercel.json、ACCOUNTING_SETUP.md 一起拖進上傳區。不要上傳 ZIP 本身或外層資料夾。
5. 檢查列表有 api/index.js、accounting/ledger.js 等路徑，再按 Commit changes。這會更新舊聊天程式，並通常觸發 Vercel 部署。

本 ZIP 不會刪除資料庫或原始碼的舊目錄。GitHub 歷史保留舊版本，但不要在未評估前把舊聊天程式恢復到正式環境。

## 2. Vercel 設定
在專案 Settings → Build and Deployment：
- Node.js：24.x（package.json 也已指定）。
- Framework Preset：Other。
- Root Directory：專案根目錄。
- 不需要自訂 Build Command 或 Output Directory；取消舊的覆寫值。
- 如有自訂 Install Command，使用 npm ci。

Environment Variables 的 Production 需要：
- LINE_CHANNEL_SECRET：你已更新的 secret。
- LINE_CHANNEL_ACCESS_TOKEN：原有 token；只有實際 LINE 回覆測試才能確認是否仍有效。
- DATABASE_URL：Neon 的資料庫連線字串，由整合自動加入。程式也支援 DATABASE_POSTGRES_URL、POSTGRES_URL。
- OWNER_LINE_USER_ID：先不用填，依下一步取得後新增。

舊版的 OPENAI_API_KEY、VERCEL_ACCESS_TOKEN、APP_STORAGE 等變數，新程式都不會讀取。不要把資料庫連線字串貼到程式碼或 GitHub。

上傳後開啟 Deployments，等待最新部署顯示 Ready。若環境變數是在部署後才修改，需再次 Redeploy 才會使用新值。

## 3. LINE 串接與本人限定
Webhook 維持：
https://gpt-ai-assistant-ochre-nine.vercel.app/webhook

到 LINE Developers 的 Messaging API 頁面確認 Use webhook 已開啟，按 Verify。建議開啟 webhook redelivery。官方帳號的自動回應若會重複回覆，請關閉。

1. 用你要記帳的個人 LINE 加官方帳號好友。
2. 私訊「我的ID」。機器人只回覆發訊者自己的 LINE user ID，不開放查帳。
3. 複製回傳的 U 開頭 ID，新增到 Vercel Production 的 OWNER_LINE_USER_ID。
4. 儲存並 Redeploy。
5. 私訊「支出 測試 1」，應收到「已記錄 #編號」。
6. 傳「明細」確認；再傳「刪除 編號」移除測試帳。

OWNER_LINE_USER_ID 未設定時不允許任何人記帳；設定後僅該本人可操作帳本。其他使用者只能查自己的 ID。群組訊息全部忽略。

## 4. 使用指令
| 訊息 | 用途 |
|---|---|
| 支出 午餐 120 | 記錄今天支出 |
| 收入 薪水 50000 | 記錄今天收入 |
| 支出 交通 80 2026-10-15 | 補記指定日期 |
| 本月 | 台北時區本月收入、支出與差額 |
| 明細 | 最近20筆新增紀錄（依編號排序） |
| 刪除 123 | 軟刪除編號123的本人紀錄 |
| 我的ID | 查詢發訊者的LINE user ID |
| 說明 | 指令說明 |

金額最多兩位小數，不輸入逗號；項目最多80字。未提供分類、發票辨識、AI語意理解、付款帳戶或多人共用。月收支差額不代表銀行餘額。

## 5. CSV 匯出
本版從電腦／主機命令列匯出，不提供公開下載網址。安裝 Node.js 24，在專案內執行 npm ci，於本機私密 .env 填 DATABASE_URL、OWNER_LINE_USER_ID，然後執行：

```
node --env-file=.env accounting/export.js accounting.csv
```

.env 不可上傳 GitHub。CSV 可用 Excel 開啟；含公式注入防護。正式長期使用請定期匯出並備份資料庫，免費方案的復原能力以 Neon 實際方案為準。

## 6. 驗證與排錯
- npm test：解析、台北日期、CSV、簽章、本人限制、重送結果重用、交易回滾及統計等本機測試。
- /health 回傳應用版本，只代表程式能啟動，不代表資料庫或 LINE token 已驗證。
- 第一次有效記帳會自動建立 personal_entries、personal_events 資料表，不需手動貼 SQL。
- 事件與入帳在同一資料庫交易內寫入；相同 webhookEventId 重送不再記一筆。個人用量以交易鎖序列化處理。
- 若 LINE 回覆失敗，可能已成功入帳，請先查「明細」，不要立刻重送同一筆新訊息。
- 舊 reply token 過期時，重送不一定能補回覆。本版尚無背景回覆佇列或自動告警。
- 502 可能來自資料庫連線或 LINE 回覆；程式日誌刻意不輸出訊息內容、使用者 ID 或金鑰。
- 實際 Neon 連線、Vercel 打包及 LINE 收發仍需部署後驗證；本機測試使用模擬外部服務。

官方參考：
https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
https://node-postgres.com/features/transactions
https://developers.line.biz/en/docs/messaging-api/receiving-messages/
