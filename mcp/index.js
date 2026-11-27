#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
    DEFAULT_SUB_PATH,
    VALID_EVENT_MODES,
    canonicalizeCommunityName,
    findAndValidateCommunity,
    insertEventIntoEvents,
    isDuplicateEvent,
    normalizeEvents,
    queryEvents,
    resolveBaseUrl,
    tagCollectionForMcp,
    validateProposeEventInput,
} from "./lib.js";

const server = new McpServer({
    name: "community-card-mcp",
    version: "2.0.0",
});

async function fetchData(filename, year = DEFAULT_SUB_PATH) {
    const url = `${resolveBaseUrl(year)}/${filename}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res.json();
}

// 📖 註冊 MCP 唯讀資源 (Resources)，提供提案與貢獻指南小抄
server.resource(
    "guidelines",
    "community-card://guidelines",
    {
        name: "社群活動提案與貢獻指南",
        description: "提供高雄社群名牌卡活動提案的欄位規範、社群官方代表色與限制說明，供 AI 助理參考",
        mimeType: "text/markdown"
    },
    async () => {
        let communityListMd;
        try {
            const data = await fetchData("data.json", DEFAULT_SUB_PATH);
            communityListMd = data.communities
                .map(c => `* **${c.name}** (代表色: ${c.color || "#808080"})`)
                .join("\n");
        } catch (err) {
            communityListMd = `* *(無法即時載入社群名冊，請呼叫 \`get_communities\` 工具查詢完整清單)*`;
        }

        return {
            contents: [{
                uri: "community-card://guidelines",
                mimeType: "text/markdown",
                text: `# 🪪 高雄社群名牌卡活動提案指南

歡迎使用 AI 助理進行高雄在地技術社群的活動提案！為確保資料格式一致性，請務必遵循以下規範：

## 1. 欄位約束與限制
* **活動日期 (date)**：必須為 \`YYYY-MM-DD\` 格式，且必須在合理的時間範圍內（當前月份前一個月至未來十二個月內，支援跨年排程與補登）。
* **主辦社群 (community)**：必須對應官方註冊的社群名稱。若名稱有微小拼寫錯誤，伺服器會自動模糊糾錯並對齊。
* **活動標題 (title)**：活動的主標題（例如 "TOOCON #42"）。**強烈約束：必須精確、一字不漏地使用使用者提供的原始標題，絕對不能進行任何翻譯、擴充、修飾或改寫！**
* **簡短描述 (description)**：**強烈約束：描述內容絕對不可超過 50 個字**！若超過 50 個字，提案將會失敗。
* **報名連結 (link)**：必須是有效的 \`http://\` 或 \`https://\` 網址。
* **活動形式 (mode)**：選填，可為 \`onsite\`（現場）、\`online\`（線上）或 \`hybrid\`（混合），未提供時預設為 \`onsite\`。

## 2. 官方註冊之社群清單（自 data.json 即時同步）
${communityListMd}

請在發送 PR 提案前，仔細閱讀此指南以確保提案順利通過。`
            }]
        };
    }
);

server.tool(
    "get_communities",
    "取得社群清單與介紹",
    {},
    async () => {
        try {
            const data = await fetchData("data.json", DEFAULT_SUB_PATH);
            return {
                content: [{ type: "text", text: JSON.stringify(tagCollectionForMcp(data.communities), null, 2) }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `讀取社群資料失敗: ${error.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    "get_events",
    "取得社群活動行事曆",
    {
        month: z.string().optional().describe("過濾特定月份的活動 (格式: YYYY-MM)，若未提供則自動進行 Token 精簡，回傳上個月起共四個月（含前一個月、當月與未來兩個月）的活動"),
    },
    async ({ month }) => {
        try {
            const result = await queryEvents({
                month,
                defaultYear: DEFAULT_SUB_PATH,
                resolveYearKey: (year) => resolveBaseUrl(year),
                fetchEventsByYear: (year) => fetchData("events.json", year),
            });

            if (result.mode === "month") {
                return {
                    content: [{
                        type: "text",
                        text: `已為您篩選出 ${result.month} 月份的完整活動資料（共 ${result.events.length} 筆）：\n` +
                              JSON.stringify(tagCollectionForMcp(result.events), null, 2)
                    }]
                };
            }

            let responseText = "";
            if (result.shouldCompress) {
                const windowLabel = result.usedFallbackWindow
                    ? `${result.monthsToInclude[0]} 至 ${result.monthsToInclude[3]}（共四個月）`
                    : `上個月起四個月（${result.monthsToInclude[0]} 至 ${result.monthsToInclude[3]}）`;
                responseText += `ℹ️ [已啟動 Token 精簡與摘要機制]\n`;
                responseText += `本次查詢未提供特定月份 (month) 參數，伺服器已自動篩選${windowLabel}的活動，並隱藏了詳細描述 (description) 與連結 (link) 欄位以節省您的記號 (Token) 消耗並提升回應速度。\n`;
                responseText += `💡 若您需要某個月份的完整詳細活動與報名連結，請重新呼叫 'get_events' 並傳入參數，例如: { "month": "${result.monthsToInclude[1]}" }。\n\n`;
            } else {
                responseText += `已為您自動篩選 ${result.monthsToInclude[0]} 至 ${result.monthsToInclude[3]} 的活動清單（共 ${result.totalCount} 筆）：\n`;
            }

            responseText += JSON.stringify(tagCollectionForMcp(result.events), null, 2);

            return {
                content: [{ type: "text", text: responseText }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `讀取活動資料失敗: ${error.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    "get_sponsors",
    "取得贊助商清單",
    {},
    async () => {
        try {
            const data = await fetchData("data.json", DEFAULT_SUB_PATH);
            return {
                content: [{ type: "text", text: JSON.stringify(tagCollectionForMcp(data.sponsors), null, 2) }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `讀取贊助商資料失敗: ${error.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    "get_rewards",
    "取得集章獎勵清單",
    {},
    async () => {
        try {
            const data = await fetchData("data.json", DEFAULT_SUB_PATH);
            return {
                content: [{ type: "text", text: JSON.stringify(tagCollectionForMcp(data.rewards), null, 2) }]
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `讀取集章獎勵資料失敗: ${error.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    "propose_new_event",
    "建立一個 Pull Request 來新增一個社群活動",
    {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須為 YYYY-MM-DD").describe("活動日期 (例如: 2027-01-15)"),
        title: z.string().min(1, "標題不能為空").describe("活動標題。強烈約束：必須精確、一字不漏地使用使用者提供的原始標題，絕對不能進行任何翻譯、擴充、修飾或改寫！"),
        community: z.string().min(1, "社群名稱不能為空").describe("主辦社群名稱 (例如: GDG Kaohsiung)"),
        description: z.string().optional().default("").describe("活動簡短介紹，絕對不能超過 50 個字（不含換行）"),
        link: z.string().optional().default("#").describe("活動報名或詳細資訊連結（無連結時填 #）"),
        mode: z.enum(["onsite", "online", "hybrid"]).optional().default("onsite").describe("活動形式：onsite (現場)、online (線上)、hybrid (混合)，未提供時預設為 onsite"),
    },
    async ({ date, title, community, description, link, mode }) => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            return {
                content: [{ type: "text", text: "錯誤: 伺服器未設定 GITHUB_TOKEN，無法發送 Pull Request。" }],
                isError: true,
            };
        }

        // 🛡️ 安全合規檢查 1 & 2：日期窗口、標題不可全空白、HTML 標籤、簡介正規化與字數、連結安全、跨年度路由
        let validatedInput;
        try {
            validatedInput = validateProposeEventInput({
                date,
                title,
                community,
                description,
                link,
                mode,
            });
        } catch (err) {
            return {
                content: [{ type: "text", text: `拒絕提案: ${err.message}` }],
                isError: true
            };
        }

        const {
            title: cleanTitle,
            description: cleanDescription,
            link: cleanLink,
            mode: eventMode,
            targetYear,
        } = validatedInput;

        try {
            // 🛡️ 語義糾錯與驗證 3：依活動年份讀取對應年度社群名冊與合作社群
            let officialCommunityName = community;
            let communityColor = "#808080";
            try {
                const [data, stamps] = await Promise.all([
                    fetchData("data.json", targetYear),
                    fetchData("stamps.json", targetYear).catch(() => ({})),
                ]);
                const allCommunities = [...(data.communities || []), ...(stamps.partners || [])];
                const validatedCommunity = findAndValidateCommunity(community, allCommunities);
                officialCommunityName = canonicalizeCommunityName(validatedCommunity.name);
                communityColor = validatedCommunity.color || "#808080";
            } catch (err) {
                return {
                    content: [{ type: "text", text: `驗證失敗: ${err.message}` }],
                    isError: true
                };
            }

            const octokit = new Octokit({ auth: token });
            const owner = process.env.GITHUB_REPO_OWNER;
            const repo = process.env.GITHUB_REPO_NAME || "CommunityCardOrg";

            if (!owner) {
                return {
                    content: [{ type: "text", text: "請設定 GITHUB_REPO_OWNER 環境變數來指定發送 PR 的目標倉庫。" }],
                    isError: true,
                };
            }

            const eventsPath = `${targetYear}/events.json`;
            const fileContent = await octokit.repos.getContent({
                owner,
                repo,
                path: eventsPath,
                ref: "main"
            });

            if (!("content" in fileContent.data)) {
                throw new Error(`Unable to read ${eventsPath} from repository`);
            }

            const currentEvents = JSON.parse(Buffer.from(fileContent.data.content, "base64").toString("utf-8"));
            const flatExisting = normalizeEvents(currentEvents);

            // 🛡️ 防護檢查 4：攔截重複活動提案
            if (isDuplicateEvent(flatExisting, { date, community: officialCommunityName, title: cleanTitle })) {
                return {
                    content: [{ type: "text", text: `拒絕提案：在 ${date} 已經存在一筆主辦社群為 "${officialCommunityName}" 且標題為 "${cleanTitle}" 的活動，請勿重複提交。` }],
                    isError: true
                };
            }

            insertEventIntoEvents(
                currentEvents,
                {
                    date,
                    community: officialCommunityName,
                    title: cleanTitle,
                    description: cleanDescription,
                    link: cleanLink,
                    color: communityColor,
                    mode: VALID_EVENT_MODES.has(eventMode) ? eventMode : "onsite",
                },
                targetYear
            );

            const updatedContentBase64 = Buffer.from(JSON.stringify(currentEvents, null, 2) + "\n").toString("base64");

            const mainRef = await octokit.git.getRef({
                owner,
                repo,
                ref: "heads/main"
            });
            const mainSha = mainRef.data.object.sha;

            const branchName = `add-event-${date.replace(/-/g, "")}-${Date.now()}`;
            await octokit.git.createRef({
                owner,
                repo,
                ref: `refs/heads/${branchName}`,
                sha: mainSha
            });

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: eventsPath,
                message: `Add event: ${cleanTitle} (${officialCommunityName})`,
                content: updatedContentBase64,
                sha: fileContent.data.sha,
                branch: branchName
            });

            const pr = await octokit.pulls.create({
                owner,
                repo,
                title: `[自動新增活動] ${cleanTitle} (${officialCommunityName})`,
                head: branchName,
                base: "main",
                body: `由 MCP AI 助理發起的活動新增請求：\n\n- 年度：${targetYear}\n- 日期：${date}\n- 社群：${officialCommunityName}\n- 標題：${cleanTitle}\n- 形式：${eventMode}\n- 介紹：${cleanDescription}\n- 連結：${cleanLink}\n- 顏色：${communityColor}`
            });

            return {
                content: [{ type: "text", text: `成功！已建立 Pull Request (${eventsPath}): ${pr.data.html_url}` }]
            };

        } catch (error) {
            return {
                content: [{ type: "text", text: `發送 PR 失敗: ${error.message}` }],
                isError: true,
            };
        }
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Community Card MCP Server running on stdio (default data: ${resolveBaseUrl(DEFAULT_SUB_PATH)})`);
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
