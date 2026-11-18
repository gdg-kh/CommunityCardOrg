import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeEvents(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item.events)) {
            for (const ev of item.events) {
                if (!ev || typeof ev.date !== 'string') continue;
                out.push({
                    date: ev.date,
                    community: item.community || ev.community || '',
                    color: ev.color || item.color || '',
                    title: ev.title ?? item.title ?? '',
                    description: ev.description ?? item.description ?? '',
                    link: ev.link ?? item.link ?? '#',
                    mode: ev.mode || item.mode || 'onsite'
                });
            }
        } else if (typeof item.date === 'string') {
            out.push({ ...item, mode: item.mode || 'onsite' });
        }
    }
    return out;
}

async function generateOGImage() {
    try {
        console.log('🚀 開始生成 OG 圖片...\n');

        // 1. 決定目標年月（命令列參數 > OG_TARGET_DATE 環境變數 > 台灣當前時間，2027 年以前預設為 2027-01）
        const argDate = process.argv[2] || process.env.OG_TARGET_DATE || '';
        let currentYear;
        let currentMonth;

        if (/^\d{4}-\d{2}/.test(argDate)) {
            const parts = argDate.split('-').map(Number);
            currentYear = parts[0];
            currentMonth = parts[1];
            if (!Number.isInteger(currentMonth) || currentMonth < 1 || currentMonth > 12) {
                throw new Error(`無效的目標月份：「${argDate}」（月份必須介於 1 到 12）`);
            }
        } else {
            const taipeiNow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
            const [y, m] = taipeiNow.split('-').map(Number);
            if (y < 2027) {
                currentYear = 2027;
                currentMonth = 1;
            } else {
                currentYear = y;
                currentMonth = m;
            }
        }

        console.log(`📅 目標月份: ${currentYear} 年 ${currentMonth} 月`);

        // 2. 讀取並正規化 2026 + 2027 events.json
        const events2026Path = path.join(__dirname, '..', '2026', 'events.json');
        const events2027Path = path.join(__dirname, '..', '2027', 'events.json');
        const raw2026 = fs.existsSync(events2026Path) ? JSON.parse(fs.readFileSync(events2026Path, 'utf-8')) : [];
        const raw2027 = fs.existsSync(events2027Path) ? JSON.parse(fs.readFileSync(events2027Path, 'utf-8')) : [];
        const eventsData = [...normalizeEvents(raw2026), ...normalizeEvents(raw2027)];
        console.log(`✅ 讀取活動數據: ${eventsData.length} 筆活動`);

        // 2b. 讀取並合併 2026 + 2027 holidays.json
        const holidays2026Path = path.join(__dirname, '..', '2026', 'holidays.json');
        const holidays2027Path = path.join(__dirname, '..', '2027', 'holidays.json');
        const holidays2026 = fs.existsSync(holidays2026Path) ? JSON.parse(fs.readFileSync(holidays2026Path, 'utf-8')) : [];
        const holidays2027 = fs.existsSync(holidays2027Path) ? JSON.parse(fs.readFileSync(holidays2027Path, 'utf-8')) : [];
        const holidaysData = [...holidays2026, ...holidays2027];
        console.log(`✅ 讀取假日數據: ${holidaysData.length} 筆假日`);

        // 3. 篩選目標月份活動
        const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const currentMonthEvents = eventsData
            .filter(event => event.date.startsWith(monthStr))
            .sort((a, b) => a.date.localeCompare(b.date));
        console.log(`✅ 篩選當月活動: ${currentMonthEvents.length} 筆`);

        // 4. 讀取模板並替換變數
        const templatePath = path.join(__dirname, 'calendar-template.html');
        let template = fs.readFileSync(templatePath, 'utf-8');

        const safeJsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
        template = template.replace(/\{\{YEAR\}\}/g, () => String(currentYear));
        template = template.replace(/\{\{MONTH\}\}/g, () => String(currentMonth));
        template = template.replace(/\{\{EVENTS_JSON\}\}/g, () => safeJsonForScript(currentMonthEvents));
        template = template.replace(/\{\{HOLIDAYS_JSON\}\}/g, () => safeJsonForScript(holidaysData));

        console.log('✅ 模板處理完成');

        // 5. 啟動 Puppeteer 渲染截圖
        console.log('🌐 啟動瀏覽器...');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({
            width: 1200,
            height: 630,
            deviceScaleFactor: 2
        });

        await page.setContent(template, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#calendar-grid');
        await page.waitForFunction(() => document.fonts.status === 'loaded');

        // 6. 儲存至對應年度的 og-images/calendar.png（2027 版獨立存放，不覆蓋 2026）
        const targetFolder = currentYear >= 2027 ? '2027' : '2026';
        const outputDir = path.join(__dirname, '..', targetFolder, 'og-images');
        fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, 'calendar.png');

        await page.screenshot({
            path: outputPath,
            type: 'png'
        });

        await browser.close();

        console.log('\n🎉 OG 圖片生成成功！');
        console.log(`📁 文件位置: ${targetFolder}/og-images/calendar.png`);
        console.log(`📏 圖片尺寸: 1200x630px`);
        console.log(`📅 月份內容: ${currentYear} 年 ${currentMonth} 月`);
    } catch (error) {
        console.error('❌ 生成失敗:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

generateOGImage();
