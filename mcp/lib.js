export const DEFAULT_SUB_PATH = process.env.COMMUNITY_CARD_SUB_PATH || "2027";
export const VALID_EVENT_MODES = new Set(["onsite", "online", "hybrid"]);

const HTML_TAG_RE = /<(?:\/?[a-z]|!|\?)/i;
const VALID_BR_RE = /<br\s*\/?>/gi;

export function resolveBaseUrl(
    year = DEFAULT_SUB_PATH,
    {
        customBaseUrl = process.env.COMMUNITY_CARD_DATA_URL || "",
        defaultSubPath = DEFAULT_SUB_PATH,
    } = {}
) {
    const targetYear = String(year || defaultSubPath);
    if (customBaseUrl) {
        const trimmed = customBaseUrl.replace(/\/+$/, "");
        if (/\/(2025|2026|2027)$/.test(trimmed)) {
            return trimmed.replace(/\/(2025|2026|2027)$/, `/${targetYear}`);
        }
        return trimmed;
    }
    return `https://community-card.org/${targetYear}`;
}

export function resolveEventYear(dateStr, defaultSubPath = DEFAULT_SUB_PATH) {
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(dateStr || "").trim());
    return m ? m[1] : defaultSubPath;
}

// 🌐 Levenshtein 距離計算，用於模糊糾錯
export function getLevenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// 標準化字串，去除空格與特殊符號，全部轉小寫以進行精準語義匹配
export function normalizeStr(str) {
    return str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

// 模糊糾錯社群名稱，回傳官方標準社群物件
export function findAndValidateCommunity(inputName, communities) {
    if (!inputName || typeof inputName !== "string") {
        throw new Error("主辦社群名稱必須是有效的字串。");
    }

    const trimmedInput = inputName.trim();
    const normalizedInput = normalizeStr(trimmedInput);
    if (!normalizedInput) {
        throw new Error("主辦社群名稱不能為空。");
    }

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

        if (
            normalizedCommunityName.includes(normalizedInput) ||
            normalizedInput.includes(normalizedCommunityName)
        ) {
            return c;
        }

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
    const distanceThreshold = 3;

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

    const availableCommunities = communities.map(c => `"${c.name}"`).join(", ");
    throw new Error(
        `找不到對應的社群 "${trimmedInput}"。請確保主辦社群名稱正確。\n目前合法的社群清單包括：[ ${availableCommunities} ]。`
    );
}

export function isValidCalendarDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return false;
    const [, y, mo, d] = m.map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validateEventDateWindow(dateStr, now = new Date()) {
    if (!isValidCalendarDate(dateStr)) {
        throw new Error(`非法的日期格式或曆日 "${dateStr}"，請使用有效的 YYYY-MM-DD。`);
    }
    const taipeiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);
    const [y, m] = taipeiDate.split("-").map(Number);
    const minStr = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const maxStr = new Date(Date.UTC(y, m + 12, 0)).toISOString().slice(0, 10);
    if (dateStr < minStr || dateStr > maxStr) {
        throw new Error(
            `活動日期 ${dateStr} 超出合理範圍。\n基於維護資料整潔與防範注入風險，目前僅接受自 ${minStr} 至 ${maxStr} 之間（即當前月份前一個月至未來十二個月內）的活動提案。`
        );
    }
}

export function isSafeHttpUrl(urlStr) {
    if (!urlStr || /[\s"'<>]/.test(urlStr)) return false;
    try {
        const u = new URL(urlStr);
        return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
    } catch {
        return false;
    }
}

export function hasDisallowedHtmlTags(str, { allowBr = false } = {}) {
    const s = String(str ?? "");
    if (!allowBr) return HTML_TAG_RE.test(s);
    const withoutValidBr = s.replace(VALID_BR_RE, "");
    return HTML_TAG_RE.test(withoutValidBr);
}

export function normalizeDescription(rawDesc = "") {
    const normalized = String(rawDesc ?? "")
        .trim()
        .replace(/\r?\n/g, "\n")
        .replace(VALID_BR_RE, "\n");
    const visibleLength = [...normalized].filter(c => c !== "\n").length;
    return {
        text: normalized.replace(/\n/g, "<br>"),
        visibleLength,
    };
}

export function validateProposeEventInput(
    { date, title, community, description = "", link = "#", mode = "onsite" },
    { now = new Date(), defaultSubPath = DEFAULT_SUB_PATH } = {}
) {
    validateEventDateWindow(date, now);

    const cleanTitle = String(title ?? "").trim();
    if (!cleanTitle) {
        throw new Error("活動標題不能為空或僅包含空白字元。");
    }
    if (hasDisallowedHtmlTags(cleanTitle, { allowBr: false })) {
        throw new Error("活動標題不可包含 HTML 標籤。");
    }

    if (hasDisallowedHtmlTags(description || "", { allowBr: true })) {
        throw new Error("活動簡介不可包含 HTML 標籤（僅允許無屬性的 <br> 換行標籤）。");
    }
    const { text: normalizedDescription, visibleLength } = normalizeDescription(description);
    if (visibleLength > 50) {
        throw new Error(`活動介紹不可超過 50 個字（目前 ${visibleLength} 字）。`);
    }

    const cleanLink = String(link ?? "#").trim() || "#";
    if (cleanLink !== "#" && !isSafeHttpUrl(cleanLink)) {
        throw new Error(
            "連結 (link) 必須是有效的 http:// 或 https:// 網址且不可包含引號或空白，以防止潛在的安全風險。"
        );
    }

    const eventMode = VALID_EVENT_MODES.has(mode) ? mode : "onsite";
    const targetYear = resolveEventYear(date, defaultSubPath);

    return {
        date,
        title: cleanTitle,
        community,
        description: normalizedDescription,
        link: cleanLink,
        mode: eventMode,
        targetYear,
    };
}

export function isDuplicateEvent(flatExisting, { date, community, title }) {
    const targetTitle = String(title ?? "").trim().toLowerCase();
    return flatExisting.some(
        e =>
            e.date === date &&
            e.community === community &&
            String(e.title ?? "").trim().toLowerCase() === targetTitle
    );
}

export function insertEventIntoEvents(currentEvents, { date, community, title, description, link, color, mode }, subPath = "2027") {
    const isGroupedFormat =
        currentEvents.some(item => item && Array.isArray(item.events)) ||
        (currentEvents.length === 0 && subPath !== "2026");

    if (isGroupedFormat) {
        let group = currentEvents.find(
            item => item && Array.isArray(item.events) && item.community === community
        );
        if (!group) {
            group = {
                community,
                color,
                events: []
            };
            currentEvents.push(group);
        }
        group.events.push({
            date,
            title,
            description,
            link,
            mode
        });
        group.events.sort((a, b) => a.date.localeCompare(b.date));
    } else {
        currentEvents.push({
            date,
            community,
            title,
            description,
            link,
            color,
            mode
        });
        currentEvents.sort((a, b) => a.date.localeCompare(b.date));
    }
    return currentEvents;
}

export function normalizeEvents(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item.events)) {
            for (const ev of item.events) {
                if (!ev || typeof ev.date !== "string") continue;
                const rawMode = ev.mode || item.mode;
                out.push({
                    date: ev.date,
                    community: item.community || ev.community || "",
                    title: ev.title ?? item.title ?? "",
                    description: ev.description ?? item.description ?? "",
                    link: ev.link ?? item.link ?? "#",
                    color: ev.color || item.color || "",
                    mode: VALID_EVENT_MODES.has(rawMode) ? rawMode : "onsite",
                });
            }
        } else if (typeof item.date === "string") {
            out.push({
                ...item,
                mode: VALID_EVENT_MODES.has(item.mode) ? item.mode : "onsite",
            });
        }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function queryEvents({
    month,
    now = new Date(),
    defaultYear = DEFAULT_SUB_PATH,
    fetchEventsByYear,
}) {
    const cleanMonth = String(month ?? "").trim();
    if (cleanMonth) {
        const yearMatch = /^(\d{4})/.exec(cleanMonth);
        const targetYear = yearMatch ? yearMatch[1] : defaultYear;
        const raw = await fetchEventsByYear(targetYear);
        const events = normalizeEvents(raw);
        const filteredEvents = events.filter(e => e.date.startsWith(cleanMonth));
        return {
            mode: "month",
            month: cleanMonth,
            events: filteredEvents,
            shouldCompress: false,
            monthsToInclude: [cleanMonth],
        };
    }

    const taipeiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);
    const [baseYr, baseMo] = taipeiDate.split("-").map(Number);

    const monthsToInclude = [];
    for (let i = -1; i < 3; i++) {
        const d = new Date(Date.UTC(baseYr, baseMo - 1 + i, 1));
        const yr = d.getUTCFullYear();
        const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
        monthsToInclude.push(`${yr}-${mo}`);
    }

    const yearsToFetch = [...new Set(monthsToInclude.map(m => m.slice(0, 4)))];
    if (!yearsToFetch.includes(defaultYear)) {
        yearsToFetch.push(defaultYear);
    }

    const settled = await Promise.allSettled(yearsToFetch.map(y => fetchEventsByYear(y)));
    const fulfilled = settled.filter(r => r.status === "fulfilled");
    if (fulfilled.length === 0) {
        const firstErr = settled[0]?.reason;
        throw firstErr instanceof Error ? firstErr : new Error("無法取得活動資料");
    }

    const allEvents = fulfilled
        .flatMap(r => normalizeEvents(r.value))
        .sort((a, b) => a.date.localeCompare(b.date));

    let effectiveMonths = monthsToInclude;
    let filteredEvents = allEvents.filter(e =>
        effectiveMonths.some(m => e.date.startsWith(m))
    );

    if (filteredEvents.length === 0 && allEvents.length > 0) {
        const hasCurrentYearEvents = allEvents.some(e => e.date.startsWith(`${baseYr}-`));
        if (!hasCurrentYearEvents) {
            const firstEventYear = Number(allEvents[0].date.slice(0, 4));
            effectiveMonths = [0, 1, 2, 3].map(offset => {
                const d = new Date(Date.UTC(firstEventYear, offset, 1));
                return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
            });
            filteredEvents = allEvents.filter(e =>
                effectiveMonths.some(m => e.date.startsWith(m))
            );
        }
    }

    const shouldCompress = filteredEvents.length > 12;
    const finalEvents = shouldCompress
        ? filteredEvents.map(e => ({
            date: e.date,
            community: e.community,
            title: e.title,
            color: e.color,
            mode: e.mode || "onsite",
        }))
        : filteredEvents;

    return {
        mode: "window",
        events: finalEvents,
        totalCount: filteredEvents.length,
        shouldCompress,
        monthsToInclude: effectiveMonths,
    };
}
