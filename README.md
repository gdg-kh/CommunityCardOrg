# 🌟 高雄社群名牌卡 (Kaohsiung Community Card)

這是一個基於「有趣」而誕生的開源專案，旨在讓每一位參與高雄在地技術社群的成員，都能擁有一個屬於自己的「社群名牌卡」，並透過數位集章的方式，紀錄一整年的社群歷程。

---

## 💡 專案特色

*   **🪪 數位名牌卡與集章體驗**：線上挑選專屬印章，點擊卡片即可輕鬆蓋章，並支援下載高解析度紀念圖檔。
*   **📅 高雄社群月曆**：整合大高雄地區各項軟體、技術與設計社群的活動資訊，讓你不再錯過任何精彩聚會。
*   **🎁 集章獎勵**：參與活動並收集印章，解鎖專屬的社群成就與獎勵。
*   **🤝 社群與贊助商介紹**：快速認識高雄在地的活躍社群與支持技術發展的贊助夥伴。

---

## 🚀 如何參與與協作

想要在社群卡片上顯示你的社群 Logo 或是將活動加入行事曆嗎？我們非常歡迎你的加入！

你可以透過以下方式參與：
1.  **提交 Pull Request (PR)**：直接 Fork 本專案並提交你的修改。
2.  **填寫表單**：透過我們的 [線上表單](https://forms.gle/38EgveLNs8WdKT5v7) 提交資訊。

---

## 🤖 給 AI 助理與開發者的整合指南 (AI Integrations)

本專案不僅服務人類開發者，更支援外部 AI 助理（如 Gemini、Claude、ChatGPT 等）直接讀取高雄在地技術社群資訊與活動行事曆，甚至允許授權的 AI 自動發起 Pull Request 來新增活動！

我們提供兩種無伺服器 (Serverless) 的整合方式：

### 1. 透過靜態 API (OpenAPI) - 適合各大主流 AI 模型

本專案提供符合標準的 `openapi.yaml` 規格檔，讓 AI 能直接讀取 GitHub Pages 上的靜態 JSON 資料。

*   **規格檔位置**：[`/openapi.yaml`](./openapi.yaml)
*   **如何使用：**
    *   **Gemini (Gems)**:
        1. 在 Gemini 中建立一個自訂 Gem。
        2. 在擴充功能 (Extensions) 或是動作 (Actions) 設定中新增一個 OpenAPI 動作。
        3. 貼上我們專案中的 `openapi.yaml` 內容。
    *   **Claude**:
        目前 Claude 網頁版尚未原生支援匯入 OpenAPI 規格，但你可以直接將 `openapi.yaml` 的網址貼給 Claude，並請它依照規格呼叫 API。
    *   **ChatGPT (Custom GPTs)**:
        1. 在 ChatGPT 建立一個自訂 GPT。
        2. 在 Configure > Actions 中點擊 "Create new action"。
        3. 貼上我們專案中的 `openapi.yaml` 內容。

    *(設定完成後，AI 就能自動看懂並呼叫 `/2026/data.json` 與 `/2026/events.json` 取得最新活動資訊！)*

### 2. 透過 MCP 伺服器 (Model Context Protocol) - 適合各類 AI 開發工具

我們在 `mcp/` 目錄下實作了一個 Node.js MCP 伺服器腳本。你不需要把專案 clone 下來，只需要透過 `npx` 指令就能在自己的電腦上讓 AI 工具直接連線本專案資料。

*   **特色功能**：
    *   `get_communities`: 查詢社群介紹。
    *   `get_events`: 查詢活動行事曆。
    *   `propose_new_event` **(需認證)**: 讓 AI 幫忙發送 Pull Request 新增活動。

*   **如何使用：**
    所有工具的連線設定都是相同的，只需要將以下設定寫入各個工具的設定檔中。

    **通用設定 JSON**：
    ```json
    {
      "mcpServers": {
        "kaohsiung-community": {
          "command": "npx",
          "args": [
            "-y",
            "github:YOUR_GITHUB_USERNAME/CommunityCardOrg#main",
            "mcp"
          ],
          "env": {
            "GITHUB_TOKEN": "如果你希望 AI 能幫忙發 PR 新增活動，請填入你的 Personal Access Token",
            "GITHUB_REPO_OWNER": "YOUR_GITHUB_USERNAME",
            "GITHUB_REPO_NAME": "CommunityCardOrg"
          }
        }
      }
    }
    ```
    *(⚠️ 注意：請將 `YOUR_GITHUB_USERNAME` 替換為實際存放此專案的 GitHub 帳號)*

    *   **Gemini CLI**: 請將上述設定加入 `~/.gemini/mcp.json` 中。
    *   **Claude Code**: 請透過指令 `claude mcp add` 或是手動將設定加入 `claude_desktop_config.json` 中。
    *   **Codex CLI**: 可以在專案的 `.codex/mcp.json` 或全域設定檔中加入上述設定。
