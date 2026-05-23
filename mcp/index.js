#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

const server = new McpServer({
    name: "community-card-mcp",
    version: "1.2.0",
});

const SUB_PATH = process.env.COMMUNITY_CARD_SUB_PATH || "2026";
const DATA_BASE_URL = process.env.COMMUNITY_CARD_DATA_URL || `https://community-card.org/${SUB_PATH}`;

async function fetchData(filename) {
    const url = `${DATA_BASE_URL}/${filename}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res.json();
}

// 🌐 Levenshtein 距離計算，用於模糊糾錯
function getLevenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // 替換 (substitution)
                    Math.min(
                        matrix[i][j - 1] + 1, // 插入 (insertion)
                        matrix[i - 1][j] + 1  // 刪除 (deletion)
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// 標準化字串，去除空格與特殊符號，全部轉小寫以進行精準語義匹配
function normalizeStr(str) {
    return str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

// 模糊糾錯社群名稱，回傳官方標準社群物件
function findAndValidateCommunity(inputName, communities) {
    if (!inputName || typeof inputName !== "string") {
        throw new Error("主辦社群名稱必須是有效的字串。");
    }

    const trimmedInput = inputName.trim();
    const normalizedInput = normalizeStr(trimmedInput);

    // 1. 精確匹配 (忽略大小寫、空格與符號)
    for (const c of communities) {
        if (normalizeStr(c.name) === normalizedInput) {
            return c;
        }
    }

    // 2. 包含比對與同義詞特徵交集比對 (例如 "高雄 GDG" 匹配 "GDG Kaohsiung")
    const cleanInput = trimmedInput.toLowerCase()
        .replace(/高雄/g, "kaohsiung")
        .replace(/kh/g, "kaohsiung");
    const inputWords = cleanInput.match(/[a-z0-9]+/g) || [];

    for (const c of communities) {
        const cleanCommunityName = c.name.toLowerCase()
            .replace(/高雄/g, "kaohsiung")
            .replace(/kh/g, "kaohsiung");
        const normalizedCommunityName = normalizeStr(cleanCommunityName);

        // 2.1 雙向直接包含
        if (
            normalizedCommunityName.includes(normalizedInput) ||
            normalizedInput.includes(normalizedCommunityName)
        ) {
            return c;
        }

        // 2.2 特徵單字交集比對 (確保輸入的每個單字都存在於社群名稱中)
        if (inputWords.length > 0) {
            const allWordsMatched = inputWords.every(w => normalizedCommunityName.includes(w));
            if (allWordsMatched) {
                return c;
            }
        }
    }

    // 3. 模糊比對 (Levenshtein 編輯距離)
    let bestMatch = null;
    let minDistance = Infinity;
    const distanceThreshold = 3; // 容許最多 3 個字元的編輯誤差

    for (const c of communities) {
        const dist = getLevenshteinDistance(
            normalizeStr(c.name),
            normalizedInput
        );
        if (dist < minDistance && dist <= distanceThreshold) {
            minDistance = dist;
            bestMatch = c;
        }
    }

    if (bestMatch) {
        return bestMatch;
    }

    // 4. 若完全匹配失敗，拋出明確錯誤，引導 AI 修正
    const availableCommunities = communities.map(c => `"${c.name}"`).join(", ");
    throw new Error(
        `找不到對應的社群 "${trimmedInput}"。請確保主辦社群名稱正確。\n目前合法的社群清單包括：[ ${availableCommunities} ]。`
    );
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

## 2. 官方註冊之社群清單 (以 data.json 為準)
* **GDG Kaohsiung** (代表色: #EA4335)
* **KIMU高雄獨立遊戲開發者聚會** (代表色: #1F70C1)
* **PyLadies Kaohsiung** (代表色: #E65A4F)
* **Kaohsiung WordPress Meetup** (代表色: #21759B)
* **COSCUP** (代表色: #0087DE)
* **高雄前端社群** (代表色: #E44D26)
* *(其他完整名冊請使用 get_communities 工具查詢)*

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
            const data = await fetchData("data.json");
            return {
                content: [{ type: "text", text: JSON.stringify(data.communities, null, 2) }]
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
        month: z.string().optional().describe("過濾特定月份的活動 (格式: YYYY-MM)，若未提供則自動進行 Token 精簡，回傳當前月份與未來三個月活動"),
    },
    async ({ month }) => {
        try {
            const events = await fetchData("events.json");
            
            if (month) {
                // 使用者有指定月份，回傳完整無刪減的資料
                const filteredEvents = events.filter(e => e.date.startsWith(month));
                return {
                    content: [{ 
                        type: "text", 
                        text: `已為您篩選出 ${month} 月份的完整活動資料（共 ${filteredEvents.length} 筆）：\n` + 
                              JSON.stringify(filteredEvents, null, 2) 
                    }]
                };
            } else {
                // 使用者未指定月份，啟動智慧精簡機制
                // 1. 取得當前基準月份 (格式 YYYY-MM)
                let baseDate = new Date();
                let year = baseDate.getFullYear();
                let monthStr = String(baseDate.getMonth() + 1).padStart(2, "0");
                let baseYearMonth = `${year}-${monthStr}`;

                // 如果本機年份與 events.json 的年份相差太大（例如開發時是 2026 年，但專案資料為其他年度），
                // 則取 events.json 第一筆資料的年份作為基準年份
                if (events.length > 0) {
                    const firstEventYear = events[0].date.split("-")[0];
                    if (year !== parseInt(firstEventYear)) {
                        baseYearMonth = `${firstEventYear}-01`; // fallback 至該年度的 1 月
                    }
                }

                // 2. 計算包含當月起共四個月的月份陣列
                const monthsToInclude = [];
                let [baseYr, baseMo] = baseYearMonth.split("-").map(Number);
                for (let i = 0; i < 4; i++) {
                    const m = baseMo + i;
                    const yOffset = Math.floor((m - 1) / 12);
                    const realMo = ((m - 1) % 12) + 1;
                    const realYr = baseYr + yOffset;
                    monthsToInclude.push(`${realYr}-${String(realMo).padStart(2, "0")}`);
                }

                // 3. 篩選活動
                const filteredEvents = events.filter(e => 
                    monthsToInclude.some(m => e.date.startsWith(m))
                );

                // 4. 智慧裁減長欄位 (以節省 Token)
                const shouldCompress = filteredEvents.length > 12;
                const finalEvents = shouldCompress 
                    ? filteredEvents.map(e => ({
                        date: e.date,
                        community: e.community,
                        title: e.title,
                        color: e.color
                        // 剔除 description 和 link 欄位
                      }))
                    : filteredEvents;

                let responseText = "";
                if (shouldCompress) {
                    responseText += `ℹ️ [已啟動 Token 精簡與摘要機制]\n`;
                    responseText += `本次查詢未提供特定月份 (month) 參數，伺服器已自動篩選當月起四個月（${monthsToInclude[0]} 至 ${monthsToInclude[3]}）的活動，並隱藏了詳細描述 (description) 與連結 (link) 欄位以節省您的記號 (Token) 消耗並提升回應速度。\n`;
                    responseText += `💡 若您需要某個月份的完整詳細活動與報名連結，請重新呼叫 'get_events' 並傳入參數，例如: { "month": "${monthsToInclude[1]}" }。\n\n`;
                } else {
                    responseText += `已為您自動篩選 ${monthsToInclude[0]} 至 ${monthsToInclude[3]} 的活動清單（共 ${filteredEvents.length} 筆）：\n`;
                }

                responseText += JSON.stringify(finalEvents, null, 2);
                
                return {
                    content: [{ type: "text", text: responseText }]
                };
            }
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
            const data = await fetchData("data.json");
            return {
                content: [{ type: "text", text: JSON.stringify(data.sponsors, null, 2) }]
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
            const data = await fetchData("data.json");
            return {
                content: [{ type: "text", text: JSON.stringify(data.rewards, null, 2) }]
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
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須為 YYYY-MM-DD").describe("活動日期 (例如: 2026-12-25)"),
        title: z.string().min(1, "標題不能為空").describe("活動標題。強烈約束：必須精確、一字不漏地使用使用者提供的原始標題，絕對不能進行任何翻譯、擴充、修飾或改寫！"),
        community: z.string().min(1, "社群名稱不能為空").describe("主辦社群名稱 (例如: GDG Kaohsiung)"),
        description: z.string().max(50, "活動介紹最多 50 個字").optional().default("").describe("活動簡短介紹，絕對不能超過 50 個字"),
        link: z.string().url("必須是有效的 URL").optional().default("").describe("活動報名或詳細資訊連結"),
    },
    async ({ date, title, community, description, link }) => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            return {
                content: [{ type: "text", text: "錯誤: 伺服器未設定 GITHUB_TOKEN，無法發送 Pull Request。" }],
                isError: true,
            };
        }

        // 🛡️ 安全合規檢查 1：動態滑動窗口驗證 (與年份脫鉤，完美支援未來 v2 演進)
        // 允許範圍：當前月份的前一個月 (允許補登) 至當前月份的未來十二個月 (支援跨年排程與長期預告)
        const eventDateObj = new Date(date);
        if (isNaN(eventDateObj.getTime())) {
            return {
                content: [{ type: "text", text: `拒絕提案: 非法的日期格式 "${date}"，請使用 YYYY-MM-DD。` }],
                isError: true
            };
        }

        const now = new Date();
        // 計算允許起點：上個月的 1 號 (例如 5/22 時，起點為 4/1)
        const minAllowedDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        // 計算允許終點：十二個月後的月底 (例如 5/22 時，終點為隔年 5/31)
        const maxAllowedDate = new Date(now.getFullYear(), now.getMonth() + 13, 0);

        if (eventDateObj < minAllowedDate || eventDateObj > maxAllowedDate) {
            const minStr = minAllowedDate.toISOString().split("T")[0];
            const maxStr = maxAllowedDate.toISOString().split("T")[0];
            return {
                content: [{ type: "text", text: `拒絕提案: 活動日期 ${date} 超出合理範圍。\n基於維護資料整潔與防範注入風險，目前僅接受自 ${minStr} 至 ${maxStr} 之間（即當前月份前一個月至未來十二個月內）的活動提案。` }],
                isError: true
            };
        }

        // 🛡️ 安全合規檢查 2：確保連結網址使用安全通訊協定
        if (link && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(link)) {
            return {
                content: [{ type: "text", text: `拒絕提案: 連結 (link) 必須是有效的 http:// 或 https:// 網址，以防止潛在的安全風險。` }],
                isError: true
            };
        }

        try {
            // 🛡️ 語義糾錯與驗證 3：社群名稱模糊糾錯
            let officialCommunityName = community;
            let communityColor = "#808080";
            try {
                const data = await fetchData("data.json");
                const validatedCommunity = findAndValidateCommunity(community, data.communities);
                officialCommunityName = validatedCommunity.name;
                communityColor = validatedCommunity.color || "#808080";
            } catch (err) {
                return {
                    content: [{ type: "text", text: `驗證失敗: ${err.message}` }],
                    isError: true
                };
            }

            const newEvent = {
                date,
                community: officialCommunityName,
                title,
                description,
                link,
                color: communityColor
            };

            const octokit = new Octokit({ auth: token });
            const owner = process.env.GITHUB_REPO_OWNER;
            const repo = process.env.GITHUB_REPO_NAME || "CommunityCardOrg";

            if (!owner) {
               return {
                   content: [{ type: "text", text: "請設定 GITHUB_REPO_OWNER 環境變數來指定發送 PR 的目標倉庫。" }],
                   isError: true,
               };
            }

            const fileContent = await octokit.repos.getContent({
                owner,
                repo,
                path: `${SUB_PATH}/events.json`,
                ref: "main"
            });

            if (!("content" in fileContent.data)) {
                throw new Error("Unable to read events.json from repository");
            }

            const currentEvents = JSON.parse(Buffer.from(fileContent.data.content, "base64").toString("utf-8"));

            // 🛡️ 防護檢查 4：攔截重複活動提案
            const isDuplicate = currentEvents.some(e => 
                e.date === date && 
                e.community === officialCommunityName && 
                e.title.trim().toLowerCase() === title.trim().toLowerCase()
            );
            if (isDuplicate) {
                return {
                    content: [{ type: "text", text: `拒絕提案：在 ${date} 已經存在一筆主辦社群為 "${officialCommunityName}" 且標題為 "${title}" 的活動，請勿重複提交。` }],
                    isError: true
                };
            }

            currentEvents.push(newEvent);
            currentEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            const updatedContentBase64 = Buffer.from(JSON.stringify(currentEvents, null, 2)).toString("base64");

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
                path: `${SUB_PATH}/events.json`,
                message: `Add event: ${title} (${officialCommunityName})`,
                content: updatedContentBase64,
                sha: fileContent.data.sha,
                branch: branchName
            });

            const pr = await octokit.pulls.create({
                owner,
                repo,
                title: `[自動新增活動] ${title} (${officialCommunityName})`,
                head: branchName,
                base: "main",
                body: `由 MCP AI 助理發起的活動新增請求：\n\n- 日期：${date}\n- 社群：${officialCommunityName}\n- 標題：${title}\n- 介紹：${description}\n- 顏色：${communityColor}`
            });

            return {
                content: [{ type: "text", text: `成功！已建立 Pull Request: ${pr.data.html_url}` }]
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
    console.error(`Community Card MCP Server running on stdio (data: ${DATA_BASE_URL})`);
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
