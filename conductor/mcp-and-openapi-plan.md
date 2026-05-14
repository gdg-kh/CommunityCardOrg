# 讓社群資料支援 AI 存取 (MCP & OpenAPI) 實作計畫

## Objective (目標)
1. 讓外部的 AI 助理（如 Gemini）能夠讀取 `2026/data.json` 與 `2026/events.json` 中的資訊（免伺服器費）。
2. 讓經過認證的 AI 助理，可以透過發送 GitHub Pull Request (PR) 的方式，協助新增活動資料。

## Scope & Impact (範圍與影響)
我們將採取雙管齊下的策略，這不會影響現有的 GitHub Pages 靜態網站運行：
1. **OpenAPI 靜態規格**：讓支援自訂 API 網址的 AI 可以直接讀取 JSON (唯讀)。
2. **MCP (Model Context Protocol) 伺服器腳本**：
   - 讀取資料：透過 `npx` 在使用者本機端執行腳本來取得資料。
   - 寫入資料：若使用者提供 `GITHUB_TOKEN`，則啟用 `propose_new_event` 工具，透過 GitHub API 發送 PR 來新增活動。

## Implementation Steps (實作步驟)

### 階段一：實作靜態 API (OpenAPI) - 唯讀
1. 建立 `openapi.yaml` 檔案於專案根目錄。
2. 定義唯讀 API 路徑：`GET /2026/data.json` 與 `GET /2026/events.json`。

### 階段二：實作 MCP Server 腳本 - 讀取與 PR 寫入
1. 建立 `mcp/` 目錄並初始化 Node.js 專案。
2. 安裝 `@modelcontextprotocol/sdk` 與 `@octokit/rest` (處理 GitHub API)。
3. **定義強型別與規則 (JSON Schema / Zod)**：
   - 包含嚴格的字數限制與業務邏輯驗證。
4. 撰寫 `mcp/index.js`，註冊以下 Tools：
   - `get_communities`: 讀取社群資料。
   - `get_events`: 讀取活動資料。
   - `propose_new_event`: 
     - (需認證) 接收符合 Schema 規則的活動資料。
     - 伺服器端實作邏輯判斷：比對現有網站社群，如果是已知社群，使用其專屬顏色；如果是未知社群，強制指定為灰色 (例如 `#808080`)。
     - 驗證 description 長度不能超過 20 個字。
     - 透過 Octokit 在 GitHub 上建立一個新的 branch 並發起 PR 修改 `2026/events.json`。

### 階段三：更新文件與使用說明
1. 更新 `README.md` 加入 AI 整合章節。
2. 說明如何設定 `GITHUB_TOKEN` 環境變數來啟用 AI 新增活動的功能。

## 關於 AI 如何知道填入規則？ (Schema 範例)
當我們定義 `propose_new_event` 時，Schema 會如此設計：
- `date`: 必填，格式 `YYYY-MM-DD`。
- `title`: 必填，字串。
- `community`: 必填，字串。
- `description`: 字串，**會特別加上 `maxLength: 20` 的限制**。如果 AI 試圖塞入超過 20 個字的介紹，系統會直接報錯拒絕。如果要換行，請使用 `<br>`。
- `color`: 在指令描述中會告知 AI 顏色的規則，同時我們的 Node.js 腳本在收到資料準備發 PR 前，會進行**二次驗證與覆寫**：
  - 程式碼會去查 `2026/events.json` 裡該社群曾用過的顏色。
  - 如果該社群不在網站上，程式碼會自動把 `color` 欄位強制改成灰色 `#808080`，確保版面統一。