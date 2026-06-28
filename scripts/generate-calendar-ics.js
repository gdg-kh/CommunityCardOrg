import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

/**
 * 將字串編碼為 UID 安全的 ASCII 字串。
 * 使用 encodeURIComponent 保留所有字元（含中文），
 * 確保同一天同社群但不同標題的活動不會產生相同 UID。
 */
function uidPart(str) {
  if (!str) return '';
  return encodeURIComponent(str);
}

/**
 * ICS 文字欄位逸出：
 * \ → \\  ;  → \;  ,  → \,  換行 → \n
 */
function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * 取得事件的日期資訊。
 * 第一版：全天事件，從 event.date 推導 DTSTART（當天）與 DTEND（隔天）。
 * 未來若 events.json 加入 startTime / endTime / startDateTime / endDateTime，
 * 只需修改此函式，不需重寫整個 ICS 產生流程。
 */
function getEventDates(event) {
  const [y, m, d] = event.date.split('-').map(Number);
  const start = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  const nextDay = new Date(y, m - 1, d + 1);
  const end = `${nextDay.getFullYear()}${String(nextDay.getMonth() + 1).padStart(2, '0')}${String(nextDay.getDate()).padStart(2, '0')}`;
  return { start, end };
}

/**
 * 產生事件的穩定 UID。
 * 格式：<date>-<encoded-community>-<encoded-title>@community-card.org
 * 同一筆活動只要 date / community / title 不變，UID 就不變。
 * 使用 encodeURIComponent 保留中文等非 ASCII 字元，避免 UID 衝突。
 */
function getEventUID(event) {
  const parts = [event.date, uidPart(event.community), uidPart(event.title)].filter(Boolean);
  return `${parts.join('-')}@community-card.org`;
}

/**
 * 組事件 SUMMARY：<community> - <title>，若無 title 則只放 <community>。
 */
function getEventSummary(event) {
  return event.title
    ? `${event.community} - ${event.title}`
    : event.community;
}

/**
 * 組事件 DESCRIPTION：
 * 1. 放 description（<br> 轉換行）
 * 2. 若 link 存在且不是 #，下一行加「活動連結：<link>」
 */
function getEventDescription(event) {
  const parts = [];
  if (event.description) {
    parts.push(event.description.replace(/<br\s*\/?>/gi, '\n'));
  }
  if (event.link && event.link !== '#') {
    parts.push('活動連結：' + event.link);
  }
  return parts.join('\n');
}

/**
 * 將單一事件轉成 ICS VEVENT 行陣列。
 */
function eventToICS(event) {
  const { start, end } = getEventDates(event);
  const uid = getEventUID(event);
  const summary = escapeICS(getEventSummary(event));
  const description = escapeICS(getEventDescription(event));
  const hasLink = event.link && event.link !== '#';

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${summary}`,
  ];
  if (description) {
    lines.push(`DESCRIPTION:${description}`);
  }
  if (hasLink) {
    lines.push(`URL:${event.link}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * 將事件陣列轉成完整 ICS 檔案字串。
 */
function generateICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Community Card Org//高雄社群活動//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:高雄社群月曆',
  ];
  for (const event of events) {
    lines.push(...eventToICS(event));
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * 掃描根目錄下所有「目錄名是四位數字且底下有 events.json」的年度目錄。
 * 若指定 yearArg，則只回傳該年度。
 */
function discoverYearDirs(yearArg) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const yearDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}$/.test(entry.name)) continue;
    if (yearArg && entry.name !== yearArg) continue;
    const eventsPath = path.join(rootDir, entry.name, 'events.json');
    if (!fs.existsSync(eventsPath)) continue;
    yearDirs.push(entry.name);
  }
  return yearDirs.sort();
}

/**
 * 為單一年度目錄產生 ICS 檔案。
 */
function generateForYear(year) {
  const eventsPath = path.join(rootDir, year, 'events.json');
  const outputPath = path.join(rootDir, year, 'community-calendar.ics');

  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
  console.log(`✅ 讀取 ${year}/events.json：${events.length} 筆活動`);

  const icsContent = generateICS(events);
  fs.writeFileSync(outputPath, icsContent, 'utf-8');
  console.log(`✅ 產生 ${year}/community-calendar.ics`);
}

function main() {
  const args = process.argv.slice(2);
  const yearArg = args[0] || null;

  if (yearArg && !/^\d{4}$/.test(yearArg)) {
    console.error(`❌ 無效的年度參數：${yearArg}（需為四位數字）`);
    process.exit(1);
  }

  const yearDirs = discoverYearDirs(yearArg);

  if (yearDirs.length === 0) {
    console.error('❌ 找不到任何包含 events.json 的年度目錄');
    process.exit(1);
  }

  console.log('🚀 開始產生社群月曆 ICS...\n');

  for (const year of yearDirs) {
    generateForYear(year);
  }

  console.log('\n🎉 ICS 產生完成！');
}

main();
