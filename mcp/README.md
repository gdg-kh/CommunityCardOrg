# community-card-mcp

社群名牌卡 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 伺服器：透過 stdio 提供「查詢社群／活動／贊助商／集章獎勵」與「自動發 PR 新增活動」共五個工具，讓 AI 助理可以直接讀取與貢獻社群名牌卡專案的資料。

預設指向 [高雄社群名牌卡](https://community-card.org)，但可透過環境變數指向任意 fork（例：台北社群卡、台中社群卡）。

## 提供的工具

| 工具 | 參數 | 權限 | 說明 |
|---|---|---|---|
| `get_communities` | 無 | 唯讀 | 取得社群清單與介紹 |
| `get_events` | `month`（選填，`YYYY-MM`） | 唯讀 | 取得活動行事曆，可依月份過濾 |
| `get_sponsors` | 無 | 唯讀 | 取得贊助商清單 |
| `get_rewards` | 無 | 唯讀 | 取得集章獎勵清單 |
| `propose_new_event` | `date`、`title`、`community`、`description`（≤50 字）、`link` | 需 GitHub Token | 在指定 repo 自動建立 PR 新增活動 |

## 環境變數

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `COMMUNITY_CARD_DATA_URL` | – | `https://community-card.org/2026` | 資料來源基底 URL；fork 至其他城市時改成自己的網址 |
| `GITHUB_TOKEN` | 僅 `propose_new_event` 工具需要 | – | 對目標 repo 有 `repo` 權限的 Personal Access Token |
| `GITHUB_REPO_OWNER` | 僅 `propose_new_event` 工具需要 | – | 目標 repo 擁有者（例：`gdg-kh`） |
| `GITHUB_REPO_NAME` | 僅 `propose_new_event` 工具需要 | `CommunityCardOrg` | 目標 repo 名稱 |

## 在 AI 工具中使用

把以下設定寫入各 AI 工具的 MCP 設定檔即可（不需要 clone repo）：

```json
{
  "mcpServers": {
    "community-card": {
      "command": "npx",
      "args": ["-y", "community-card-mcp"],
      "env": {
        "GITHUB_TOKEN": "（選填）若希望 AI 能發 PR 新增活動，請填入 Personal Access Token",
        "GITHUB_REPO_OWNER": "gdg-kh",
        "GITHUB_REPO_NAME": "CommunityCardOrg"
      }
    }
  }
}
```

各工具設定檔位置與完整教學請見 [主專案 README](https://github.com/gdg-kh/CommunityCardOrg#-給-ai-助理與開發者的整合指南-ai-integrations)。

## License

MIT — see [LICENSE](https://github.com/gdg-kh/CommunityCardOrg/blob/main/LICENSE) in the main repo.
