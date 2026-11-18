// 🧪 community-card-mcp 伺服器本地驗證測試腳本
// 執行方式：在專案根目錄執行 node mcp/test.js

import fs from "node:fs";
import path from "node:path";
import {
    DEFAULT_SUB_PATH,
    findAndValidateCommunity,
    hasDisallowedHtmlTags,
    insertEventIntoEvents,
    isDuplicateEvent,
    isSafeHttpUrl,
    normalizeDescription,
    normalizeEvents,
    queryEvents,
    resolveBaseUrl,
    resolveEventYear,
    validateEventDateWindow,
    validateProposeEventInput,
} from "./lib.js";

// 載入 2026/data.json 與 2027/data.json 的真實社群名冊
const realData2026 = JSON.parse(fs.readFileSync(path.join("2026", "data.json"), "utf8"));
const realData2027 = JSON.parse(fs.readFileSync(path.join("2027", "data.json"), "utf8"));
const communities = realData2026.communities;
const communities2027 = realData2027.communities;
const events2026 = JSON.parse(fs.readFileSync(path.join("2026", "events.json"), "utf8"));

console.log("=== 🧪 開始執行 community-card-mcp 2.0.0 本地測試 ===\n");

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

function assertThrows(fn, expectedSubstring, message) {
    try {
        fn();
        assert(false, `${message}（預期應拋出錯誤卻通過）`);
    } catch (err) {
        assert(
            !expectedSubstring || err.message.includes(expectedSubstring),
            `${message}: ${err.message}`
        );
    }
}

// ----------------------------------------------------
// 測試區塊 1: 模糊糾錯與標準化功能
// ----------------------------------------------------
console.log("--- [測試 1] 社群名稱模糊糾錯功能 ---");

try {
    const c1 = findAndValidateCommunity("GDG Kaohsiung", communities);
    assert(c1.name === "GDG Kaohsiung", `精確匹配 "GDG Kaohsiung" -> ${c1.name}`);

    const c2 = findAndValidateCommunity("gdgkaohsiung", communities);
    assert(c2.name === "GDG Kaohsiung", `忽略空格與大小寫 "gdgkaohsiung" -> ${c2.name}`);

    const c3 = findAndValidateCommunity("高雄 GDG", communities);
    assert(c3.name === "GDG Kaohsiung", `語義包含匹配 "高雄 GDG" -> ${c3.name}`);

    const c4 = findAndValidateCommunity("pyladies kh", communities);
    assert(c4.name === "PyLadies Kaohsiung", `語義包含匹配 "pyladies kh" -> ${c4.name}`);

    const c5 = findAndValidateCommunity("GDG Kaohsiun", communities);
    assert(c5.name === "GDG Kaohsiung", `Levenshtein 糾錯 "GDG Kaohsiun" -> ${c5.name}`);

    const c6 = findAndValidateCommunity("高雄 WordPress", communities2027);
    assert(c6.name === "高雄 WordPress", `2027 社群名冊匹配 "高雄 WordPress" -> ${c6.name}`);

    assertThrows(
        () => findAndValidateCommunity("台北 Android 社群", communities),
        "找不到對應的社群",
        "非法社群拒絕並提示合法清單"
    );
} catch (err) {
    console.error("測試 1 發生非預期錯誤:", err);
    failedTests++;
}

// ----------------------------------------------------
// 測試區塊 2: 安全合規防禦、標題空白、簡介正規化與 HTML 過濾
// ----------------------------------------------------
console.log("\n--- [測試 2] 安全合規防護與輸入合理性校驗 ---");

const fixedNow = new Date("2026-11-18T12:00:00+08:00");

try {
    validateEventDateWindow("2026-11-18", fixedNow);
    assert(true, "動態滑動窗口：當前日期 (2026-11-18) 驗證成功通過。");

    validateEventDateWindow("2026-10-15", fixedNow);
    assert(true, "動態滑動窗口：上月補登日期 (2026-10-15) 驗證成功通過。");

    validateEventDateWindow("2027-01-10", fixedNow);
    assert(true, "動態滑動窗口：跨年未來日期 (2027-01-10) 驗證成功通過。");
} catch (err) {
    assert(false, `合法滑動窗口日期錯誤攔截: ${err.message}`);
}

assertThrows(() => validateEventDateWindow("2027-02-30", fixedNow), "非法的日期格式或曆日", "無效曆日被安全攔截");
assertThrows(() => validateEventDateWindow("2024-11-01", fixedNow), "超出合理範圍", "歷史日期被安全攔截");
assertThrows(() => validateEventDateWindow("2028-11-01", fixedNow), "超出合理範圍", "遙遠未來日期被安全攔截");

assert(isSafeHttpUrl("https://gdg.community.dev/e/m8qd55/"), "合法 HTTPS 網址通過。");
assert(!isSafeHttpUrl("javascript:alert(1)"), "惡意 javascript: 網址被安全攔截。");
assert(!isSafeHttpUrl('https://example.com/"onmouseover="alert(1)'), "含引號屬性注入網址被安全攔截。");

// HTML 標籤拒絕測試（含未閉合標籤與帶屬性 <br>）
assert(hasDisallowedHtmlTags("<img src=x onerror=alert(1)", { allowBr: false }), "標題拒絕未閉合 HTML 標籤");
assert(hasDisallowedHtmlTags("<img src=x onerror=alert(1)", { allowBr: true }), "簡介拒絕未閉合 HTML 標籤");
assert(hasDisallowedHtmlTags('<br onmouseover="alert(1)">', { allowBr: true }), "簡介拒絕帶屬性 <br onmouseover=...>");
assert(hasDisallowedHtmlTags("<br/onload=alert(1)>", { allowBr: true }), "簡介拒絕 <br/onload=...>");
assert(hasDisallowedHtmlTags("</br>", { allowBr: true }), "簡介拒絕 </br>");
assert(hasDisallowedHtmlTags("<br", { allowBr: true }), "簡介拒絕未閉合 <br");
assert(hasDisallowedHtmlTags("<<br>img src=x>", { allowBr: true }), "簡介拒絕巢狀 <<br>img>");
assert(!hasDisallowedHtmlTags("第一行<br>第二行<br/>第三行<br />第四行", { allowBr: true }), "簡介允許無屬性 <br> / <br/> / <br />");

// validateProposeEventInput 測試
assertThrows(
    () => validateProposeEventInput(
        { date: "2027-01-15", title: "   \t\n  ", community: "GDG Kaohsiung" },
        { now: fixedNow }
    ),
    "活動標題不能為空",
    "propose_new_event 拒絕全空白標題"
);

assertThrows(
    () => validateProposeEventInput(
        { date: "2027-01-15", title: "講座 <img src=x onerror=alert(1)", community: "GDG Kaohsiung" },
        { now: fixedNow }
    ),
    "HTML 標籤",
    "propose_new_event 拒絕未閉合標題標籤"
);

assertThrows(
    () => validateProposeEventInput(
        { date: "2027-01-15", title: "講座", community: "GDG Kaohsiung", description: '介紹<br onmouseover="alert(1)">' },
        { now: fixedNow }
    ),
    "HTML 標籤",
    "propose_new_event 拒絕帶屬性 <br>"
);

assertThrows(
    () => validateProposeEventInput(
        { date: "2027-01-15", title: "講座", community: "GDG Kaohsiung", description: "字".repeat(51) },
        { now: fixedNow }
    ),
    "不可超過 50 個字",
    "propose_new_event 拒絕超過 50 字的簡介"
);

const validatedDescCase = validateProposeEventInput(
    {
        date: "2027-01-15",
        title: "  TOOCON #42  ",
        community: "GDG Kaohsiung",
        description: `  ${"字".repeat(25)}\r\n${"文".repeat(25)}  `,
        link: "https://gdg.community.dev/e/test/",
        mode: "hybrid",
    },
    { now: fixedNow }
);
assert(
    validatedDescCase.title === "TOOCON #42" &&
    validatedDescCase.description === `${"字".repeat(25)}<br>${"文".repeat(25)}` &&
    validatedDescCase.targetYear === "2027",
    "簡介自動 trim、將換行正規化為 <br>，且換行不計入 50 字可見字數上限"
);

const normDesc = normalizeDescription("  第一行\n第二行<br />第三行  ");
assert(normDesc.text === "第一行<br>第二行<br>第三行" && normDesc.visibleLength === 9, "normalizeDescription 正確處理前後空白與 <br />");

// 重複活動攔截測試
const existingEvents = normalizeEvents([
    {
        community: "GDG Kaohsiung",
        color: "#EA4335",
        events: [{ date: "2027-01-15", title: "TOOCON #42", link: "#" }],
    },
]);
assert(
    isDuplicateEvent(existingEvents, { date: "2027-01-15", community: "GDG Kaohsiung", title: "  toocon #42 " }),
    "isDuplicateEvent 可忽略大小寫與前後空白攔截重複活動"
);
assert(
    !isDuplicateEvent(existingEvents, { date: "2027-01-16", community: "GDG Kaohsiung", title: "TOOCON #42" }),
    "不同日期不誤判為重複活動"
);

// ----------------------------------------------------
// 測試區塊 3: 跨年度路由與實際 queryEvents 邏輯驗證
// ----------------------------------------------------
console.log("\n--- [測試 3] 跨年度路由與 queryEvents 實作驗證 ---");

assert(DEFAULT_SUB_PATH === "2027" || Boolean(process.env.COMMUNITY_CARD_SUB_PATH), `預設 SUB_PATH 為 2027 (目前: ${DEFAULT_SUB_PATH})`);
assert(resolveEventYear("2026-12-20") === "2026", "2026-12-20 路由至 2026");
assert(resolveEventYear("2027-01-15") === "2027", "2027-01-15 路由至 2027");
assert(
    resolveBaseUrl("2026", { customBaseUrl: "https://community-card.org/2027" }) === "https://community-card.org/2026",
    "resolveBaseUrl 支援跨年度切換基底網址"
);

const sample2027Grouped = [
    {
        community: "GDG Kaohsiung",
        color: "#EA4335",
        events: [
            { date: "2027-01-10", title: "2027 開年聚會", description: "說明", link: "https://example.com/2027", mode: "hybrid" },
        ],
    },
];

const fetchedYears = [];
const mockFetchByYear = async (yr) => {
    fetchedYears.push(yr);
    if (yr === "2026") return events2026;
    if (yr === "2027") return sample2027Grouped;
    return [];
};

// 3A. 跨年度視窗查詢（2026-11-18 -> 涵蓋 2026-10..2027-01）
const crossYearRes = await queryEvents({
    now: new Date("2026-11-18T12:00:00+08:00"),
    defaultYear: "2027",
    fetchEventsByYear: mockFetchByYear,
});
assert(
    fetchedYears.includes("2026") && fetchedYears.includes("2027") &&
    crossYearRes.events.some(e => e.date.startsWith("2026-")) &&
    crossYearRes.events.some(e => e.date === "2027-01-10"),
    "queryEvents 未指定月份時可跨年度合併 2026 與 2027 活動"
);

// 3B. 超過 12 筆時啟動 Token 精簡
const may2026Window = await queryEvents({
    now: new Date("2026-05-15T12:00:00+08:00"),
    defaultYear: "2027",
    fetchEventsByYear: mockFetchByYear,
});
assert(
    may2026Window.shouldCompress &&
    may2026Window.events.every(e => e.description === undefined && e.link === undefined),
    `活動數量 (${may2026Window.totalCount} 筆) > 12 時自動精簡 description 與 link 欄位`
);

// 3C. 指定單一月份（2026-05 與 2027-01）
const mayRes = await queryEvents({ month: "2026-05", defaultYear: "2027", fetchEventsByYear: mockFetchByYear });
assert(
    mayRes.events.length > 0 &&
    mayRes.events.every(e => e.date.startsWith("2026-05") && e.description !== undefined && e.link !== undefined),
    `指定 month="2026-05" 正確讀取 2026 資料並回傳完整欄位（共 ${mayRes.events.length} 筆）`
);

const jan2027Res = await queryEvents({ month: " 2027-01 ", defaultYear: "2027", fetchEventsByYear: mockFetchByYear });
assert(
    jan2027Res.events.length === 1 && jan2027Res.events[0].title === "2027 開年聚會" && jan2027Res.month === "2027-01",
    "指定 month=\" 2027-01 \" 可正確 trim 並讀取 2027 分組資料"
);

const blankMonthRes = await queryEvents({
    month: "   ",
    now: new Date("2026-11-18T12:00:00+08:00"),
    defaultYear: "2027",
    fetchEventsByYear: mockFetchByYear,
});
assert(
    blankMonthRes.mode === "window" && blankMonthRes.events.length > 0,
    "全空白 month 參數會自動回退為跨年度視窗模式"
);

// ----------------------------------------------------
// 測試區塊 4: 2027 分組格式與 2026 扁平格式雙向正規化
// ----------------------------------------------------
console.log("\n--- [測試 4] 2027 分組格式與 2026 扁平格式正規化驗證 ---");

try {
    const flatNormalized = normalizeEvents(events2026);
    assert(
        flatNormalized.length === events2026.length && flatNormalized.every(e => e.mode === "onsite"),
        `2026 扁平格式（${flatNormalized.length} 筆）無 mode 欄位時全部自動預設為 "onsite"。`
    );

    const groupedSample = [
        {
            community: "GDG Kaohsiung",
            color: "#EA4335",
            events: [
                { date: "2027-02-10", title: "線上講座", link: "https://gdg.community.dev/", mode: "online" },
                { date: "2027-01-15", title: "實體聚會", link: "https://gdg.community.dev/" }
            ]
        }
    ];
    const groupedNormalized = normalizeEvents(groupedSample);
    assert(
        groupedNormalized.length === 2 &&
        groupedNormalized[0].date === "2027-01-15" &&
        groupedNormalized[0].mode === "onsite" &&
        groupedNormalized[0].community === "GDG Kaohsiung" &&
        groupedNormalized[1].mode === "online",
        "2027 社群分組格式成功展開、繼承外層社群屬性、預設 onsite 並依日期排序。"
    );

    const groupedTarget = [{ community: "GDG Kaohsiung", color: "#EA4335", events: [{ date: "2027-03-01", title: "Later", description: "", link: "#", mode: "onsite" }] }];
    insertEventIntoEvents(groupedTarget, { date: "2027-02-01", community: "GDG Kaohsiung", title: "Earlier", description: "", link: "https://example.com", color: "#EA4335", mode: "hybrid" }, "2027");
    assert(
        groupedTarget.length === 1 &&
        groupedTarget[0].events.length === 2 &&
        groupedTarget[0].events[0].date === "2027-02-01" &&
        groupedTarget[0].events[0].mode === "hybrid",
        "insertEventIntoEvents 可正確寫入 2027 社群分組並依日期排序。"
    );

    const flatTarget = [];
    insertEventIntoEvents(flatTarget, { date: "2026-12-20", community: "GDG Kaohsiung", title: "年底聚會", description: "", link: "https://example.com", color: "#EA4335", mode: "onsite" }, "2026");
    assert(
        flatTarget.length === 1 && !Array.isArray(flatTarget[0].events) && flatTarget[0].date === "2026-12-20",
        "insertEventIntoEvents 在 2026 空陣列時正確寫入扁平格式。"
    );
} catch (err) {
    assert(false, `正規化測試失敗: ${err.message}`);
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
    console.log("\n🎉 [SUCCESS] 所有的本地驗證測試均完美通過！MCP 伺服器 2.0.0 測試完全通過。");
}
