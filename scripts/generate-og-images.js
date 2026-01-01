import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateOGImage() {
    try {
        console.log('🚀 開始生成 OG 圖片...\n');

        // 1. Get current date
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12

        console.log(`📅 當前月份: ${currentYear} 年 ${currentMonth} 月`);

        // 2. Read events.json
        const eventsPath = path.join(__dirname, '..', '2026', 'events.json');
        const eventsData = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
        console.log(`✅ 讀取活動數據: ${eventsData.length} 筆活動`);

        // 3. Filter current month events
        const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const currentMonthEvents = eventsData.filter(event => event.date.startsWith(monthStr));
        console.log(`✅ 篩選當月活動: ${currentMonthEvents.length} 筆`);

        // 4. Read template
        const templatePath = path.join(__dirname, 'calendar-template.html');
        let template = fs.readFileSync(templatePath, 'utf-8');

        // 5. Replace placeholders
        template = template.replace(/\{\{YEAR\}\}/g, currentYear);
        template = template.replace(/\{\{MONTH\}\}/g, currentMonth);
        template = template.replace(/\{\{EVENTS_JSON\}\}/g, JSON.stringify(currentMonthEvents));

        console.log('✅ 模板處理完成');

        // 6. Launch Puppeteer
        console.log('🌐 啟動瀏覽器...');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // 7. Set viewport size
        await page.setViewport({
            width: 1200,
            height: 630,
            deviceScaleFactor: 2
        });

        console.log('✅ 設置視窗大小: 1200x630');

        // 8. Load HTML content
        await page.setContent(template, { waitUntil: 'networkidle0' });

        // 9. Wait for fonts and rendering
        await page.waitForSelector('#calendar-grid');
        await page.waitForFunction(() => document.fonts.status === 'loaded');

        console.log('✅ 頁面渲染完成');

        // 10. Take screenshot
        const outputDir = path.join(__dirname, '..', '2026', 'og-images');
        const outputPath = path.join(outputDir, 'calendar.png');

        await page.screenshot({
            path: outputPath,
            type: 'png'
        });

        console.log(`✅ 截圖保存: ${outputPath}`);

        // 11. Close browser
        await browser.close();

        console.log('\n🎉 OG 圖片生成成功！');
        console.log(`📁 文件位置: 2026/og-images/calendar.png`);
        console.log(`📏 圖片尺寸: 1200x630px`);
        console.log(`📅 月份內容: ${currentYear} 年 ${currentMonth} 月`);

    } catch (error) {
        console.error('❌ 生成失敗:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the script
generateOGImage();
