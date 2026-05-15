#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

const server = new McpServer({
    name: "community-card-mcp",
    version: "1.0.0",
});

const DATA_BASE_URL = process.env.COMMUNITY_CARD_DATA_URL || "https://community-card.org/2026";

async function fetchData(filename) {
    const url = `${DATA_BASE_URL}/${filename}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res.json();
}

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
        month: z.string().optional().describe("過濾特定月份的活動 (格式: YYYY-MM)，若未提供則回傳所有活動"),
    },
    async ({ month }) => {
        try {
            const events = await fetchData("events.json");
            const filteredEvents = month
                ? events.filter(e => e.date.startsWith(month))
                : events;
            return {
                content: [{ type: "text", text: JSON.stringify(filteredEvents, null, 2) }]
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

async function proposeDataJsonPullRequest({ section, newItem, branchPrefix, prTitle, commitMessage, prBody }) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return {
            content: [{ type: "text", text: "錯誤: 伺服器未設定 GITHUB_TOKEN，無法發送 Pull Request。" }],
            isError: true,
        };
    }

    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME || "CommunityCardOrg";
    if (!owner) {
        return {
            content: [{ type: "text", text: "請設定 GITHUB_REPO_OWNER 環境變數來指定發送 PR 的目標倉庫。" }],
            isError: true,
        };
    }

    try {
        const octokit = new Octokit({ auth: token });

        const fileContent = await octokit.repos.getContent({
            owner,
            repo,
            path: "2026/data.json",
            ref: "main"
        });
        if (!("content" in fileContent.data)) {
            throw new Error("Unable to read 2026/data.json from repository");
        }

        const currentData = JSON.parse(Buffer.from(fileContent.data.content, "base64").toString("utf-8"));
        if (!Array.isArray(currentData[section])) {
            throw new Error(`data.json 中找不到 ${section} 陣列`);
        }
        currentData[section].push(newItem);

        const updatedContentBase64 = Buffer.from(JSON.stringify(currentData, null, 2)).toString("base64");

        const mainRef = await octokit.git.getRef({ owner, repo, ref: "heads/main" });
        const mainSha = mainRef.data.object.sha;

        const slug = (newItem.name || section).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || section;
        const branchName = `${branchPrefix}-${slug}-${Date.now()}`;
        await octokit.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branchName}`,
            sha: mainSha
        });

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: "2026/data.json",
            message: commitMessage,
            content: updatedContentBase64,
            sha: fileContent.data.sha,
            branch: branchName
        });

        const pr = await octokit.pulls.create({
            owner,
            repo,
            title: prTitle,
            head: branchName,
            base: "main",
            body: prBody
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

server.tool(
    "propose_new_sponsor",
    "建立一個 Pull Request 來新增一個贊助商",
    {
        name: z.string().min(1, "名稱不能為空").describe("贊助商名稱"),
        link: z.string().url("必須是有效的 URL").describe("贊助商官網或介紹頁連結"),
        logo: z.string().min(1, "logo 路徑不能為空").describe("贊助商 logo 相對路徑，例如 ../assets/sponsor_xxx.png"),
        description: z.string().optional().default("").describe("贊助商簡介，可包含 <br> 換行"),
    },
    async ({ name, link, logo, description }) => {
        return proposeDataJsonPullRequest({
            section: "sponsors",
            newItem: { name, link, logo, description },
            branchPrefix: "add-sponsor",
            prTitle: `[自動新增贊助商] ${name}`,
            commitMessage: `Add sponsor: ${name}`,
            prBody: `由 MCP AI 助理發起的贊助商新增請求：\n\n- 名稱：${name}\n- 連結：${link}\n- Logo：${logo}\n- 介紹：${description}`
        });
    }
);

server.tool(
    "propose_new_reward",
    "建立一個 Pull Request 來新增一個集章獎勵項目",
    {
        name: z.string().min(1, "名稱不能為空").describe("獎勵項目名稱"),
        link: z.string().url("必須是有效的 URL").describe("獎勵說明或活動連結"),
        logo: z.string().min(1, "logo 路徑不能為空").describe("獎勵 logo 相對路徑，例如 ../assets/rewards_xxx.png"),
        description: z.string().optional().default("").describe("獎勵說明，可包含 <br> 換行"),
    },
    async ({ name, link, logo, description }) => {
        return proposeDataJsonPullRequest({
            section: "rewards",
            newItem: { name, link, logo, description },
            branchPrefix: "add-reward",
            prTitle: `[自動新增集章獎勵] ${name}`,
            commitMessage: `Add reward: ${name}`,
            prBody: `由 MCP AI 助理發起的集章獎勵新增請求：\n\n- 名稱：${name}\n- 連結：${link}\n- Logo：${logo}\n- 介紹：${description}`
        });
    }
);

server.tool(
    "propose_new_event",
    "建立一個 Pull Request 來新增一個社群活動",
    {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須為 YYYY-MM-DD").describe("活動日期 (例如: 2026-12-25)"),
        title: z.string().min(1, "標題不能為空").describe("活動標題"),
        community: z.string().min(1, "社群名稱不能為空").describe("主辦社群名稱 (例如: GDG Kaohsiung)"),
        description: z.string().max(20, "活動介紹最多 20 個字").optional().default("").describe("活動簡短介紹，絕對不能超過 20 個字"),
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

        try {
            let communityColor = "#808080";
            try {
                const data = await fetchData("data.json");
                const foundCommunity = data.communities.find(c =>
                    c.name === community ||
                    c.name.includes(community) ||
                    community.includes(c.name)
                );
                if (foundCommunity && foundCommunity.color) {
                    communityColor = foundCommunity.color;
                }
            } catch {
                // 查不到顏色就 fallback 預設灰色，不阻斷 PR 建立
            }

            const newEvent = {
                date,
                community,
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
                path: "2026/events.json",
                ref: "main"
            });

            if (!("content" in fileContent.data)) {
                throw new Error("Unable to read events.json from repository");
            }

            const currentEvents = JSON.parse(Buffer.from(fileContent.data.content, "base64").toString("utf-8"));
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
                path: "2026/events.json",
                message: `Add event: ${title} (${community})`,
                content: updatedContentBase64,
                sha: fileContent.data.sha,
                branch: branchName
            });

            const pr = await octokit.pulls.create({
                owner,
                repo,
                title: `[自動新增活動] ${title} (${community})`,
                head: branchName,
                base: "main",
                body: `由 MCP AI 助理發起的活動新增請求：\n\n- 日期：${date}\n- 社群：${community}\n- 標題：${title}\n- 介紹：${description}\n- 顏色：${communityColor}`
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
