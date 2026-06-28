# 🌟 高雄社群名牌卡 (Kaohsiung Community Card)

這是一個基於「有趣」而誕生的開源專案，旨在讓每一位參與高雄在地技術社群的成員，都能擁有一個屬於自己的「社群名牌卡」，並透過集章的方式，紀錄一整年的社群歷程。

本專案同時被設計為**可被其他城市/組織 fork 的範本**（例：台北社群卡、台中社群卡），詳情請見下方 [🍴 Fork 與客製化指南](#-fork-與客製化指南給其他城市組織)。

---

## 💡 專案特色

*   **🪪 數位名牌卡與集章體驗**：線上挑選專屬印章，點擊卡片即可輕鬆蓋章，並支援下載高解析度紀念圖檔。
*   **📅 高雄社群月曆**：整合大高雄地區各項軟體、技術與設計社群的活動資訊，讓你不再錯過任何精彩聚會。
    社群月曆支援 Google Calendar 訂閱，來源為年度目錄下的 community-calendar.ics，
    並由 GitHub Action 根據 events.json 自動更新。
*   **🎁 集章獎勵**：參與活動並收集印章，解鎖專屬的社群成就與獎勵。
*   **🤝 社群與贊助商介紹**：快速認識高雄在地的活躍社群與支持技術發展的贊助夥伴。
*   **🤖 AI 友善**：同時提供 OpenAPI 規格與 MCP 伺服器，讓 AI 助理可以直接查詢資料、甚至代為發 Pull Request。

---

## 🪪 集章與印章機制

*   **印章圖檔**：位於 `assets/stamps/`，依社群命名（例如 `seal_toocon.png`、`seal_developer_buffet_blue.png`）。
*   **使用方式**：於 `2026/index.html` 點擊印章按鈕，再點卡片對應位置即可蓋章；點擊「清除印章」可重置。
*   **下載**：完成集章後可下載高解析度紀念圖檔。
*   **新增/替換印章**（給 fork 者）：把 PNG 放入 `assets/stamps/`，依社群命名規則對應到 `2026/data.json` 中的社群即可。

---

## 🛠️ 本機開發與部署

### 環境需求

*   Node.js ≥ 18

### 安裝與啟動

```bash
# 安裝相依套件（主要供 OG 圖產生用）
npm install

# 產生 Open Graph 圖片
npm run generate-og

# 從年度 events.json 產生 Google Calendar 訂閱用 ICS
npm run generate-ics
```

本專案是純靜態網站，直接用瀏覽器打開 `2026/index.html` 就能預覽。

### 部署

採用 **GitHub Pages** 部署：

*   根目錄的 `CNAME` 檔指定自訂網域（原專案為 `community-card.org`）。
*   若 fork 後沒有自訂網域，**請刪除 `CNAME`**，直接使用 `<user>.github.io/<repo>` 即可。

### 資料夾結構速覽

| 路徑 | 說明 |
|---|---|
| `2026/index.html`、`2026/sponsors.html` | 該年度頁面 |
| `2026/data.json` | 社群、贊助商、獎勵資料 |
| `2026/events.json` | 活動行事曆 |
| `2026/community-calendar.ics` | Google Calendar 訂閱用 ICS，由 events.json 產生 |
| `2025/` | 前一年度封存 |
| `assets/stamps/` | 印章圖檔 |
| `mcp/` | MCP 伺服器 |
| `openapi.yaml` | OpenAPI 規格 |
| `scripts/generate-og-images.js` | OG 圖產生器 |

---

## 🚀 如何參與與協作

我們歡迎兩種參與情境：

### A. 對本專案貢獻（高雄社群活動 / 印章 / 功能）

1.  **Fork 本專案**並建立分支。
2.  視需求修改下列檔案：
    *   新增活動 → 編輯 `2026/events.json`（注意 `description` **不能超過 50 個字**，詳見下方 [資料 Schema](#資料-schema-速查)）。
    *   新增社群 → 編輯 `2026/data.json` 的 `communities`。
    *   新增印章 → 放 PNG 到 `assets/stamps/`。
3.  本機用瀏覽器開啟 `2026/index.html` 確認顯示無誤。
4.  發送 Pull Request。

或透過 [線上表單](https://forms.gle/38EgveLNs8WdKT5v7) 提交資訊。

### B. Fork 為自己城市/組織使用

請參考下方 [🍴 Fork 與客製化指南](#-fork-與客製化指南給其他城市組織)。

---

## 🍴 Fork 與客製化指南（給其他城市/組織）

想用這個專案做「台北社群卡」、「台中社群卡」、或公司內部活動集章卡嗎？以下是 fork 後需要客製化的清單：

| # | 檔案 | 位置/欄位 | 改成什麼 |
|---|---|---|---|
| 1 | `README.md` | 城市名、網域、repo 路徑、社群名稱等敘述 | 改成你的城市/組織內容 |
| 2 | `openapi.yaml` | `servers[0].url` | 你的 GitHub Pages 網址（例 `https://your-domain.com` 或 `https://yourname.github.io/YourRepo`） |
| 3 | `CNAME` | 整個內容 | 你的自訂網域；若無自訂網域可**刪除此檔** |
| 4 | `package.json` | `name`、`description` | 你的專案資訊 |
| 5 | `LICENSE` | 版權人 | 加上自己的姓名/組織（建議保留原作者欄位） |
| 6 | `2026/data.json` | `communities`、`sponsors`、`rewards` | 你的城市的社群資料 |
| 7 | `2026/events.json` | 全部 | 你的城市的活動資料 |
| 8 | `assets/stamps/` | PNG 檔 | 你的城市的印章設計 |

> 💡 **MCP 伺服器不需要 fork**：fork 後只需在 AI 工具的 MCP 設定中把 `COMMUNITY_CARD_DATA_URL` 環境變數指向你的 GitHub Pages 網址（例 `https://taipei-card.org/2026`），就能直接使用發佈在 npm 上的 [`community-card-mcp`](https://www.npmjs.com/package/community-card-mcp) 套件，不必修改 `mcp/` 內任何檔案或重新發佈 npm。詳見下方「2. 透過 MCP 伺服器」章節。

### 資料更新工作流

Fork 後若只是要定期維護自家社群的活動，建議流程：

1.  每月固定更新 `events.json`。
2.  Push 到 main 分支，GitHub Pages 會自動部署。
3.  若想讓 AI 自動發 PR 新增活動，請參考下方 MCP 段落設定 `GITHUB_TOKEN`。

---

## 🤖 給 AI 助理與開發者的整合指南 (AI Integrations)

本專案不僅服務人類開發者，更支援外部 AI 助理（如 Gemini、Claude、ChatGPT 等）直接讀取在地技術社群資訊與活動行事曆，甚至允許授權的 AI 自動發起 Pull Request 來新增活動！

我們提供兩種無伺服器 (Serverless) 的整合方式：

### 1. 透過靜態 JSON 端點 (OpenAPI) - 適合具備網址擷取能力的 AI

本專案在 GitHub Pages 直接公開兩支可供 AI 讀取的靜態 JSON 端點，並提供 [`/openapi.yaml`](./openapi.yaml) 作為這些端點的**規格說明文件**（描述欄位、型別、限制）：

*   社群資料：`https://community-card.org/2026/data.json`
*   活動行事曆：`https://community-card.org/2026/events.json`

依需求選擇下列其中一種使用方式：

**A. 直接擷取 JSON 網址（最簡單，適合一次性查詢）**

把上述 JSON 或 `openapi.yaml` 的網址貼到具備 WebFetch 能力的 AI 工具（例如 Claude Code、Gemini CLI）對話中，AI 會自行讀取資料並依規格回答。不需要任何額外設定。

**B. 透過 MCP 伺服器（推薦，適合穩定整合）**

若希望 AI 能直接呼叫專屬工具（`get_communities`、`get_events`、`get_sponsors`、`get_rewards`），甚至自動發 PR 新增活動（`propose_new_event`），請參考下方「2. 透過 MCP 伺服器」章節的設定步驟。

> ⚠️ 注意：目前主流 AI CLI 工具（Claude Code / Gemini CLI / Codex CLI）**沒有原生「匯入 OpenAPI 規格作為 Action」的 UI**。`openapi.yaml` 在本專案的角色是給 AI 與 MCP 伺服器**參照欄位定義**，不是被當成可呼叫的動作清單匯入。

#### 資料 Schema 速查

詳細欄位定義請看 [`openapi.yaml`](./openapi.yaml)，以下為摘要：

**`/2026/data.json`** 結構：

| 區塊 | 欄位 | 型別 | 必填 | 說明/約束 |
|---|---|---|---|---|
| `communities[]` | `name` | string | ✓ | 社群名稱 |
| | `link` | string (URI) | ✓ | 社群連結 |
| | `logo` | string | ✓ | Logo 圖檔路徑或 URL |
| | `description` | string | ✓ | 社群介紹 |
| | `color` | string | ✓ | hex 代表色，例如 `#EA4335` |
| `sponsors[]` | `name` / `link` / `logo` / `description` | string | ✓ | 贊助商（同上但無 `color`） |
| `rewards[]` | `name` / `link` / `logo` / `description` | string | ✓ | 集章獎勵項目 |

**`/2026/events.json`**（陣列，每筆為一個活動物件）：

| 欄位 | 型別 | 必填 | 約束 |
|---|---|---|---|
| `date` | string | ✓ | `YYYY-MM-DD`，例如 `2026-05-15` |
| `community` | string | ✓ | 主辦社群名稱（需對應 `communities[].name`） |
| `title` | string | ✓ | 活動標題 |
| `description` | string | – | **最多 50 個字**（與 MCP `propose_new_event` 限制一致） |
| `link` | string | ✓ | 報名/詳情連結 |
| `color` | string | ✓ | hex 顏色，應對應主辦社群代表色 |

JSON 範例：

```json
{
  "date": "2026-06-09",
  "community": "GDG Kaohsiung",
  "title": "TOOCON #42",
  "description": "使用 Skills 打造 AI CLI 設定精靈",
  "link": "https://gdg.community.dev/e/m8qd55/",
  "color": "#EA4335"
}
```

### 2. 透過 MCP 伺服器 (Model Context Protocol) - 適合各類 AI 開發工具

我們在 npm 發佈了 [`community-card-mcp`](https://www.npmjs.com/package/community-card-mcp) 套件，內含一個輕量的 Node.js MCP 伺服器。你不需要 clone 專案，只要透過 `npx` 指令就能在 AI 工具中直接連線本專案資料。

#### 可用工具

| 工具 | 參數 | 權限 | 說明 |
|---|---|---|---|
| `get_communities` | 無 | 唯讀 | 取得社群清單與介紹 |
| `get_events` | `month`（選填，格式 `YYYY-MM`） | 唯讀 | 取得活動行事曆，可依月份過濾 |
| `get_sponsors` | 無 | 唯讀 | 取得贊助商清單 |
| `get_rewards` | 無 | 唯讀 | 取得集章獎勵清單 |
| `propose_new_event` | `date`、`title`、`community`、`description`（≤50 字）、`link` | **需 GitHub Token** | 自動建立 PR 新增活動 |

#### 環境變數

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `COMMUNITY_CARD_DATA_URL` | – | `https://community-card.org` | 資料來源基底 URL；fork 至其他城市/組織時改成自己的網址（例 `https://taipei-card.org`） |
| `COMMUNITY_CARD_SUB_PATH` | – | `2026` | 年度/版本子目錄路徑（例如當前為 2026；年底轉移時可改為 v2 以實現與年份脫鉤） |
| `GITHUB_TOKEN` | 僅 `propose_new_event` 工具需要 | – | 需有目標 repo `repo` 權限的 Personal Access Token |
| `GITHUB_REPO_OWNER` | 僅 `propose_new_event` 工具需要 | – | 目標 repo 擁有者（例：`gdg-kh`） |
| `GITHUB_REPO_NAME` | 僅 `propose_new_event` 工具需要 | `CommunityCardOrg` | 目標 repo 名稱 |

#### 安裝設定

所有 AI 工具的連線設定都是相同的，只需要將以下設定寫入各個工具的設定檔中：

**通用設定 JSON**：

```json
{
  "mcpServers": {
    "community-card": {
      "command": "npx",
      "args": ["-y", "community-card-mcp"],
      "env": {
        "COMMUNITY_CARD_DATA_URL": "https://community-card.org",
        "COMMUNITY_CARD_SUB_PATH": "2026",
        "GITHUB_TOKEN": "（選填）若希望 AI 能發 PR 新增活動，請填入你的 Personal Access Token",
        "GITHUB_REPO_OWNER": "gdg-kh",
        "GITHUB_REPO_NAME": "CommunityCardOrg"
      }
    }
  }
}
```

*（高雄使用者可直接使用以上預設；fork 至其他城市/組織者請把 `COMMUNITY_CARD_DATA_URL`、`GITHUB_REPO_OWNER`、`GITHUB_REPO_NAME` 改為自己的網址與 repo。）*

各工具的設定檔位置：

*   **Claude Code**：執行 `claude mcp add` 互動式新增，或手動把上述 JSON 加到 `~/.claude.json`（全域）或專案的 `.mcp.json`。
*   **Gemini CLI**：把設定加到 `~/.gemini/settings.json` 的 `mcpServers` 區塊。
*   **Codex CLI**：把設定加到 `~/.codex/config.toml` 的 `[mcp_servers.community-card]` 區段，或專案 `.codex/mcp.json`。

#### 驗證安裝

最快的本機驗證：

```bash
npx -y community-card-mcp
# 應印出（stderr）：Community Card MCP Server running on stdio (data: https://community-card.org/2026)
# 按 Ctrl+C 結束。
```

在各 AI 工具中驗證：

*   **Claude Code**：對話中輸入 `/mcp` 應看到 `community-card` 狀態為 `connected`。
*   **Gemini CLI**：輸入 `/mcp` 或 `/tools` 應列出 `get_communities`、`get_events`、`propose_new_event`。
*   **Codex CLI**：輸入 `/mcp` 或 `mcp list` 確認連線狀態。

若連線失敗，最常見原因：
1.  Node.js 版本低於 18。
2.  MCP 設定 JSON 格式錯誤（多了逗號、引號等）。
3.  Fork 至其他城市時，忘了把 `COMMUNITY_CARD_DATA_URL` 改成自己的 GitHub Pages 網址，AI 會抓到原始的高雄資料。

---

## 📜 授權

本專案採 [MIT License](./LICENSE) 授權，歡迎自由使用、修改、散布。Fork 者請保留原作者欄位並可在 `LICENSE` 中追加自己的姓名/組織。
