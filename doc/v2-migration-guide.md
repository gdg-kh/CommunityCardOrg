# 🪪 高雄社群名牌卡 - v2 年份脫鉤轉移指南 (Migration Guide)

> [!NOTE]
> **給年底 AI 助理的溫馨提示：**
> 歡迎你！這份文件是 2026 年 5 月的 AI 助理（Antigravity）與專案負責人精心討論設計的「無痛升級與過渡方案」。你的任務是將專案從「一年一網站（如 `2026/`）」重構為「永續經營且與年份脫鉤的 `/v2` 架構」，同時確保過去宣傳出去的舊連結（如 `2026/calendar.html`）**絕對不會 404**。
>
> 請嚴格遵循以下步驟進行自動化重構，以達成極致無痛的遷移。

---

## 🎯 轉移目標架構

1. **網域不變**：`CNAME` 檔案必須保持 `community-card.org` 不動，確保自訂網域綁定完好。
2. **主站升級**：新版網站部署於 `v2/` 子路徑（或直接放於根目錄 `/`），網址永久固定。
3. **舊連結防守**：舊年份路徑（`/2026/`、`/2025/`）以 **「HTML/JS 跳轉樁 (Redirect Stubs)」** 進行防守，點擊舊宣傳連結時能在 0.1 秒內自動平滑跳轉至新版對應頁面。
4. **MCP 伺服器解耦**：MCP 伺服器在 `1.2.0` 版本中已將路徑解耦為環境變數 `COMMUNITY_CARD_SUB_PATH`（預設 `"2026"`）。你只需要在年底將其改為 `"v2"`，無須修改任何伺服器代碼。

---

## 🛠️ Step-by-Step 執行清單 (Checklist)

### ⬜ 步驟一：建立全新的 v2 前端網頁與資料夾
1. 在專案根目錄建立 `v2/` 以及 `v2/data/` 資料夾。
2. 將 `2026/` 目錄下的所有 HTML、CSS、JavaScript、圖片與資源檔案複製到 `v2/` 目錄中。
3. 建立 `v2/data/data.json`（存放社群基礎資訊、贊助商名冊與集章獎勵）。
4. 建立 `v2/data/active_events.json`（**最新活動行事曆，用以取代 events.json**），這只存放「近期與未來」的活動，確保檔案體積輕量。
5. 建立 `v2/data/archive/` 目錄，用以存放過去年份的歷史活動（例如把 `2025/events.json` 和 `2026/events.json` 的舊資料放入 `v2/data/archive/events_2025.json` 等）。

---

### ⬜ 步驟二：配置舊路徑「跳轉樁（Redirect Stubs）」防止 404
> [!IMPORTANT]
> **千萬不要刪除 `2026/` 與 `2025/` 目錄！**
> 為了防守過去在社群中散播的舊宣傳連結，我們需要將這些目錄下的 HTML 檔案改寫為極簡的跳轉程式碼。

1. 清空 `2026/index.html` 內容，寫入以下代碼：
   ```html
   <!DOCTYPE html>
   <html>
   <head>
       <meta charset="utf-8">
       <title>高雄社群名牌卡 - 網頁搬家導向中</title>
       <script>
           window.location.replace("../v2/index.html");
       </script>
       <meta http-equiv="refresh" content="0;url=../v2/index.html">
   </head>
   <body>
       <p>高雄社群名牌卡已全面升級！頁面正在自動導向中...</p>
       <p>如果沒有自動跳轉，請<a href="../v2/index.html">點擊這裡</a>。</p>
   </body>
   </html>
   ```

2. 清空 `2026/calendar.html`（或任何已宣傳的頁面），寫入以下代碼：
   ```html
   <!DOCTYPE html>
   <html>
   <head>
       <meta charset="utf-8">
       <title>高雄社群名牌卡 - 網頁搬家導向中</title>
       <script>
           window.location.replace("../v2/calendar.html");
       </script>
       <meta http-equiv="refresh" content="0;url=../v2/calendar.html">
   </head>
   <body>
       <p>行事曆已全面升級！頁面正在自動導向中...</p>
       <p>如果沒有自動跳轉，請<a href="../v2/calendar.html">點擊這裡</a>。</p>
   </body>
   </html>
   ```

---

### ⬜ 步驟三：修改根目錄 `/index.html` 的跳轉設定
目前專案根目錄下的 `/index.html` 是負責將首頁訪客引流到當前年份。請將其修改為跳轉到全新的 `v2` 頁面。

1. 開啟根目錄的 [index.html](file:///Users/andyawd/Project/CommunityCardOrg/index.html)。
2. 將所有指向 `2026/index.html` 的代碼，全部替換為 `v2/index.html`。
   * 修改關鍵跳轉（約第 18 行）：
     ```javascript
     window.location.replace("v2/index.html");
     ```
   * 修改 Meta Refresh（約第 21 行）：
     ```html
     <meta content="0;url=v2/index.html" http-equiv="refresh">
     ```
   * 修改底部備用超連結: 將 `href="2026/index.html"` 改為 `href="v2/index.html"`。

---

### ⬜ 步驟四：一秒啟用 MCP 伺服器的 V2 動態路由
`community-card-mcp` 伺服器在 `1.2.0` 版本中，已將所有年份硬編碼移出，並改為讀取環境變數 `COMMUNITY_CARD_SUB_PATH`（預設為 `"2026"`）。

當你完成上述步驟一的 v2 資料夾建置後，你**不需要修改 MCP 伺服器的任何程式碼**！你只需要指引負責人在其 IDE（Cursor 或 Claude Code 等）的 MCP 設定中，加入一個環境變數即可：

```json
{
  "mcpServers": {
    "community-card": {
      "command": "npx",
      "args": ["-y", "community-card-mcp"],
      "env": {
        "COMMUNITY_CARD_SUB_PATH": "v2", 
        "COMMUNITY_CARD_DATA_URL": "https://community-card.org/v2/data",
        "GITHUB_TOKEN": "...",
        "GITHUB_REPO_OWNER": "gdg-kh",
        "GITHUB_REPO_NAME": "CommunityCardOrg"
      }
    }
  }
}
```
> [!TIP]
> 啟用此設定後，MCP 伺服器的所有 Tool（工具）與 Resource（資源）都會在一瞬間全部無痛切換！
> * 讀取端將改為 fetch `https://community-card.org/v2/data/data.json` 與 `active_events.json`。
> * AI 提報活動的新 PR，寫入路徑將會自動切換為 `v2/data/active_events.json` 與 `v2/data/data.json`。
> * 1.2.0 版本實作的「動態滑動窗口驗證」（當前時間 -1 個月至 +12 個月）將在 v2 目錄下終身免維護自動運作！

---

### ⬜ 步驟五：設定 GitHub Actions 「智慧自動歸檔」工作流 (選填建議)
為了讓 `v2/data/active_events.json` 永久保持輕量（避免隨著時間累積讓檔案無限長大、導致網頁變慢與 AI 消耗過多元件 Token），建議建立一個自動歸檔機制。

在 `.github/workflows/archive-events.yml` 中建立以下工作流：
```yaml
name: Auto Archive Past Events

on:
  schedule:
    # 每年 12 月 31 日子夜執行 (Cron 格式: 分 時 日 月 星期)
    - cron: '0 0 31 12 *'
  workflow_dispatch: # 支援手動觸發

jobs:
  archive:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run Archive Script
        run: |
          node -e '
          const fs = require("fs");
          const path = require("path");
          
          const activePath = path.join("v2", "data", "active_events.json");
          if (!fs.existsSync(activePath)) process.exit(0);
          
          const events = JSON.parse(fs.readFileSync(activePath, "utf8"));
          const currentYear = new Date().getFullYear();
          
          // 過濾出屬於過去年份的活動
          const pastEvents = events.filter(e => {
            const yr = parseInt(e.date.split("-")[0]);
            return yr < currentYear;
          });
          
          // 依然保留在 active_events.json 中的活動 (今年與未來)
          const remainingEvents = events.filter(e => {
            const yr = parseInt(e.date.split("-")[0]);
            return yr >= currentYear;
          });
          
          if (pastEvents.length === 0) {
            console.log("沒有需要歸檔的過去活動。");
            process.exit(0);
          }
          
          // 寫入封存檔 (例如 v2/data/archive/events_2026.json)
          const archiveDir = path.join("v2", "data", "archive");
          if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
          
          const archivePath = path.join(archiveDir, `events_${currentYear - 1}.json`);
          let existingArchive = [];
          if (fs.existsSync(archivePath)) {
            existingArchive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
          }
          const combinedArchive = [...existingArchive, ...pastEvents].sort((a,b) => new Date(a.date) - new Date(b.date));
          
          fs.writeFileSync(archivePath, JSON.stringify(combinedArchive, null, 2));
          fs.writeFileSync(activePath, JSON.stringify(remainingEvents, null, 2));
          console.log(`成功將 ${pastEvents.length} 筆活動歸檔至 ${archivePath}`);
          '

      - name: Commit and Push Changes
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: auto-archive past events to historical logs"
          file_pattern: "v2/data/"
```

---

## 🏁 轉移後驗證

轉移完成後，請務必指引負責人驗證以下事項：
1. [ ] 存取 `https://community-card.org` 應自動且順暢跳轉至 `v2/index.html`。
2. [ ] 存取舊網址 `https://community-card.org/2026/calendar.html` 應自動跳轉至 `https://community-card.org/v2/calendar.html`。
3. [ ] MCP 伺服器的 `get_events` 工具能正常回傳 `v2/data/active_events.json` 的簡精資料。
4. [ ] 透過 MCP 伺服器提報新活動，能自動發送 PR 寫入 `v2/data/active_events.json`，且動態日期滑動窗口與社群名稱糾錯功能皆完美通過。

祝你轉移順利！高雄技術社群的永續發展有你的一份功勞！💪
