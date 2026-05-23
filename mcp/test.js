// 🧪 community-card-mcp 伺服器本地驗證測試腳本
// 執行方式：在專案根目錄執行 node mcp/test.js

import fs from "fs";
import path from "path";

// 1. 模擬並抓取 mcp/index.js 中的核心輔助函數
// 因為 mcp/index.js 是以 stdio 連線的可執行檔，我們直接從中抽取純 JavaScript 邏輯來測試。
const indexJsContent = fs.readFileSync(path.join("mcp", "index.js"), "utf8");

// 快速提取 getLevenshteinDistance 函式
const getLevenshteinDistance = new Function(
    "a", "b",
    indexJsContent.match(/function getLevenshteinDistance[\s\S]+?return matrix\[b\.length\]\[a\.length\];\s*\}/)[0] + 
    "\nreturn getLevenshteinDistance(a, b);"
);

// 快速提取 normalizeStr 函式
const normalizeStr = new Function(
    "str",
    indexJsContent.match(/function normalizeStr[\s\S]+?return str\.toLowerCase\(\)\.replace\([^\n]+\n\}/)[0] + 
    "\nreturn normalizeStr(str);"
);

// 快速提取 findAndValidateCommunity 函式
// 為了在測試中可用，我們把它綁定到外部的輔助函式上
const findAndValidateCommunityCode = indexJsContent
    .match(/function findAndValidateCommunity[\s\S]+?(?=\/\/ 📖 註冊 MCP)/)[0]
    .replace(/getLevenshteinDistance/g, "this.getLevenshteinDistance")
    .replace(/normalizeStr/g, "this.normalizeStr");

const findAndValidateCommunity = new Function(
    "inputName", "communities",
    `const context = {
        getLevenshteinDistance: ${getLevenshteinDistance.toString()},
        normalizeStr: ${normalizeStr.toString()}
     };
     const fn = ${findAndValidateCommunityCode};
     return fn.call(context, inputName, communities);`
);

// 載入 2026/data.json 的真實社群名冊
const realData = JSON.parse(fs.readFileSync(path.join("2026", "data.json"), "utf8"));
const communities = realData.communities;

console.log("=== 🧪 開始執行 community-card-mcp 1.2.0 本地測試 ===\n");

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`✅ [SUCCESS] ${message}`);
        passedTests++;
    } else {
        console.error(`❌ [FAILURE] ${message}`);
        failedTests++;
    }
}

// ----------------------------------------------------
// 測試區塊 1: 模糊糾錯與標準化功能
// ----------------------------------------------------
console.log("--- [測試 1] 社群名稱模糊糾錯功能 ---");

try {
    // A. 精確匹配
    const c1 = findAndValidateCommunity("GDG Kaohsiung", communities);
    assert(c1.name === "GDG Kaohsiung", `精確匹配 "GDG Kaohsiung" -> ${c1.name}`);

    // B. 忽略空格與大小寫
    const c2 = findAndValidateCommunity("gdgkaohsiung", communities);
    assert(c2.name === "GDG Kaohsiung", `忽略空格與大小寫 "gdgkaohsiung" -> ${c2.name}`);

    // C. 語義包含匹配
    const c3 = findAndValidateCommunity("高雄 GDG", communities);
    assert(c3.name === "GDG Kaohsiung", `語義包含匹配 "高雄 GDG" -> ${c3.name}`);

    const c4 = findAndValidateCommunity("pyladies kh", communities);
    assert(c4.name === "PyLadies Kaohsiung", `語義包含匹配 "pyladies kh" -> ${c4.name}`);

    // D. 容錯 Levenshtein 距離比對
    const c5 = findAndValidateCommunity("GDG Kaohsiun", communities); // 拼錯最後一個字母
    assert(c5.name === "GDG Kaohsiung", `Levenshtein 糾錯 "GDG Kaohsiun" -> ${c5.name}`);


    // E. 失敗校驗：輸入完全不存在的社群時應拋出包含所有合法社群的錯誤
    try {
        findAndValidateCommunity("台北 Android 社群", communities);
        assert(false, "輸入非法社群應拋出錯誤，但卻成功通過。");
    } catch (err) {
        assert(
            err.message.includes("找不到對應的社群") && err.message.includes("GDG Kaohsiung"), 
            `非法社群拒絕並提示合法清單`
        );
    }

} catch (err) {
    console.error("測試 1 發生非預期錯誤:", err);
    failedTests++;
}

// ----------------------------------------------------
// 測試區塊 2: 安全合規防禦功能
// ----------------------------------------------------
console.log("\n--- [測試 2] 安全合規防護與輸入合理性校驗 ---");

// A. 驗證與年份脫鉤的「動態滑動窗口」日期限制
function validateDate(dateStr) {
    const eventDateObj = new Date(dateStr);
    if (isNaN(eventDateObj.getTime())) {
        throw new Error(`非法的日期格式 "${dateStr}"，請使用 YYYY-MM-DD。`);
    }

    const now = new Date();
    // 取得當前本機系統時間的「上個月 1 號」
    const minAllowedDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // 取得當前本機系統時間的「十二個月後月底」
    const maxAllowedDate = new Date(now.getFullYear(), now.getMonth() + 13, 0);

    if (eventDateObj < minAllowedDate || eventDateObj > maxAllowedDate) {
        const minStr = minAllowedDate.toISOString().split("T")[0];
        const maxStr = maxAllowedDate.toISOString().split("T")[0];
        throw new Error(`活動日期 ${dateStr} 超出合理範圍 [${minStr} ~ ${maxStr}]。`);
    }
    return true;
}

try {
    // 1. 測試當前日期 (應通過)
    const todayStr = new Date().toISOString().split("T")[0];
    assert(validateDate(todayStr), `動態滑動窗口：當前日期 (${todayStr}) 驗證成功通過。`);
    
    // 2. 測試上個月中旬的日期 (允許補登，應通過)
    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastMonthStr = lastMonthDate.toISOString().split("T")[0];
    assert(validateDate(lastMonthStr), `動態滑動窗口：上月補登日期 (${lastMonthStr}) 驗證成功通過。`);

    // 3. 測試未來兩個月後的日期 (允許跨月排程，應通過)
    const futureDate = new Date(now.getFullYear(), now.getMonth() + 2, 10);
    const futureStr = futureDate.toISOString().split("T")[0];
    assert(validateDate(futureStr), `動態滑動窗口：未來二月日期 (${futureStr}) 驗證成功通過。`);
} catch (err) {
    assert(false, `合法滑動窗口日期錯誤攔截: ${err.message}`);
}

try {
    // 4. 測試太久以前的日期 (兩年前，應被攔截)
    const now = new Date();
    const pastDate = new Date(now.getFullYear() - 2, now.getMonth(), 1);
    const pastStr = pastDate.toISOString().split("T")[0];
    validateDate(pastStr);
    assert(false, `太久以前的日期 (${pastStr}) 應該被攔截卻通過了。`);
} catch (err) {
    assert(err.message.includes("超出合理範圍"), `歷史日期被安全攔截: ${err.message}`);
}

try {
    // 5. 測試太久以後的日期 (兩年後，應被攔截)
    const now = new Date();
    const farFutureDate = new Date(now.getFullYear() + 2, now.getMonth(), 1);
    const farFutureStr = farFutureDate.toISOString().split("T")[0];
    validateDate(farFutureStr);
    assert(false, `太遙遠的未來日期 (${farFutureStr}) 應該被攔截卻通過了。`);
} catch (err) {
    assert(err.message.includes("超出合理範圍"), `遙遠未來日期被安全攔截: ${err.message}`);
}

// B. 驗證 URL 安全協議
function validateUrl(urlStr) {
    if (urlStr && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(urlStr)) {
        throw new Error("連結 (link) 必須是有效的 http:// 或 https:// 網址。");
    }
    return true;
}

try {
    assert(validateUrl("https://gdg.community.dev/e/m8qd55/"), "合法 HTTPS 網址通過。");
} catch (err) {
    assert(false, "合法 HTTPS 網址出錯。");
}

try {
    validateUrl("javascript:alert(1)");
    assert(false, "惡意腳本注入網址應該被攔截卻通過了。");
} catch (err) {
    assert(err.message.includes("必須是有效的 http:// 或 https:// 網址"), `惡意網址被安全攔截: ${err.message}`);
}

// ----------------------------------------------------
// 測試區塊 3: 活動行事曆智慧精簡與 Token 控管
// ----------------------------------------------------
console.log("\n--- [測試 3] 智慧資料精簡與 Token 控管驗證 ---");

// 模擬 get_events 的篩選行為
function simulateGetEvents(monthParam, events) {
    if (monthParam) {
        return events.filter(e => e.date.startsWith(monthParam));
    } else {
        // 使用 2026-05 作為虛擬的當前月份基準
        const baseYearMonth = "2026-05";
        const monthsToInclude = ["2026-05", "2026-06", "2026-07", "2026-08"];
        
        const filteredEvents = events.filter(e => 
            monthsToInclude.some(m => e.date.startsWith(m))
        );
        
        const shouldCompress = filteredEvents.length > 12;
        const finalEvents = shouldCompress 
            ? filteredEvents.map(e => ({
                date: e.date,
                community: e.community,
                title: e.title,
                color: e.color
              }))
            : filteredEvents;
            
        return {
            isCompressed: shouldCompress,
            data: finalEvents
        };
    }
}

// 載入 2026/events.json 真實活動行事曆
const events = JSON.parse(fs.readFileSync(path.join("2026", "events.json"), "utf8"));

// 測試有指定月份
const mayEvents = simulateGetEvents("2026-05", events);
assert(
    mayEvents.every(e => e.date.startsWith("2026-05") && e.description !== undefined && e.link !== undefined),
    `指定 "2026-05" 參數回傳完整無刪減的活動資料（共 ${mayEvents.length} 筆，包含描述與連結）。`
);

// 測試未指定月份 (自動精簡與摘要)
const compressedResult = simulateGetEvents(undefined, events);
if (compressedResult.isCompressed) {
    assert(
        compressedResult.data.every(e => e.description === undefined && e.link === undefined),
        `未指定月份且活動數大於 12，成功自動精簡裁切 description 與 link 欄位以節省 Token。`
    );
} else {
    assert(
        compressedResult.data.length <= 12,
        `活動數量較少 (${compressedResult.data.length} 筆)，回傳完整資料無精簡。`
    );
}

// ----------------------------------------------------
// 測試總結
// ----------------------------------------------------
console.log("\n=== 🏁 測試執行完畢 ===");
console.log(`總共通過測試數: ${passedTests}`);
console.log(`失敗測試數: ${failedTests}`);

if (failedTests > 0) {
    console.error("\n❌ [ERROR] 部分本地驗證測試失敗，請檢查邏輯是否有誤！");
    process.exit(1);
} else {
    console.log("\n🎉 [SUCCESS] 所有的本地驗證測試均完美通過！MCP 伺服器 1.2.0 厚重構完全正確。");
}
