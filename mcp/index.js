#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// Initialize the MCP Server
const server = new McpServer({
    name: "kaohsiung-community-mcp",
    version: "1.0.0",
});

// Helper to get local data paths (assuming running from /mcp or root)
const getDataPath = (filename) => {
    // Check if we are running in the mcp folder or root folder
    const relativePath = fs.existsSync(path.join(process.cwd(), "2026")) 
        ? path.join(process.cwd(), "2026", filename)
        : path.join(process.cwd(), "..", "2026", filename);
    return relativePath;
};

// Tool: Get Communities
server.tool(
    "get_communities",
    "取得高雄技術社群清單與介紹",
    {},
    async () => {
        try {
            const dataPath = getDataPath("data.json");
            const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
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

// Tool: Get Events
server.tool(
    "get_events",
    "取得高雄技術社群活動行事曆",
    {
        month: z.string().optional().describe("過濾特定月份的活動 (格式: YYYY-MM)，若未提供則回傳所有活動"),
    },
    async ({ month }) => {
        try {
            const eventsPath = getDataPath("events.json");
            const events = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));
            
            let filteredEvents = events;
            if (month) {
                filteredEvents = events.filter(e => e.date.startsWith(month));
            }
            
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

// Tool: Propose New Event
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
        // Check for GitHub Token
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            return {
                content: [{ type: "text", text: "錯誤: 伺服器未設定 GITHUB_TOKEN，無法發送 Pull Request。" }],
                isError: true,
            };
        }

        try {
            // 1. Process Business Logic: Lookup Community Color
            const dataPath = getDataPath("data.json");
            let communityColor = "#808080"; // Default grey
            
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
                // Match by mapped name or original name in events
                const foundCommunity = data.communities.find(c => 
                    c.name === community || 
                    c.name.includes(community) || 
                    community.includes(c.name)
                );
                
                if (foundCommunity && foundCommunity.color) {
                    communityColor = foundCommunity.color;
                }
            }

            const newEvent = {
                date,
                community,
                title,
                description,
                link,
                color: communityColor
            };

            // 2. GitHub API Operations
            const octokit = new Octokit({ auth: token });
            
            // Note: Since this is meant to be run via npx, the user running it needs to provide
            // the repo owner and repo name. We'll try to infer it from git config or env vars, 
            // but for safety, we require them as ENV vars if not standard.
            const owner = process.env.GITHUB_REPO_OWNER || "YOUR_GITHUB_USERNAME"; // Replace later in docs
            const repo = process.env.GITHUB_REPO_NAME || "CommunityCardOrg";
            
            if (owner === "YOUR_GITHUB_USERNAME") {
               return {
                   content: [{ type: "text", text: "請設定 GITHUB_REPO_OWNER 環境變數來指定發送 PR 的目標倉庫。" }],
                   isError: true,
               };
            }

            // Get current events.json from main branch
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
            
            // Sort by date just to be nice
            currentEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            const updatedContentBase64 = Buffer.from(JSON.stringify(currentEvents, null, 2)).toString("base64");

            // Create a new branch
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

            // Update the file in the new branch
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: "2026/events.json",
                message: `Add event: ${title} (${community})`,
                content: updatedContentBase64,
                sha: fileContent.data.sha,
                branch: branchName
            });

            // Create the Pull Request
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

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("Kaohsiung Community MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});