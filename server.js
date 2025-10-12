const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/api/collect-pet-ids-stream', (req, res) => {
    const { petName } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendUpdate = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const runScraper = async () => {
        let browser = null;
        try {
            if (!petName) throw new Error('Pet name is required.');

            sendUpdate({ type: 'log', message: 'Launching stealth browser...' });
            browser = await puppeteer.launch({
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
                ignoreHTTPSErrors: true,
            });

            const page = await browser.newPage();
            sendUpdate({ type: 'log', message: 'Navigating to StarPets.pw...' });
            await page.goto('https://starpets.pw/', { waitUntil: 'networkidle2', timeout: 90000 });

            sendUpdate({ type: 'log', message: `Typing "${petName}" into search bar...` });
            await page.type('input[placeholder="Quick search"]', petName);

            sendUpdate({ type: 'log', message: 'Pressing Enter and waiting for results...' });
            await page.keyboard.press('Enter');
            await page.waitForSelector('div[class*="_container_"]', { timeout: 30000 });

            sendUpdate({ type: 'log', message: 'Search results loaded. Clicking pet link...' });
            const [petLink] = await page.$x(`//a[contains(., "${petName}")]`);
            if (!petLink) throw new Error(`Could not find a link for "${petName}".`);

            await petLink.click();
            await page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 });
            sendUpdate({ type: 'log', message: 'On sales page. Starting ID collection...' });
            
            const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent);
            const collectedData = [];

            // Helper to click buttons and extract ID
            async function selectOptionAndGetId(optionText) {
                sendUpdate({ type: 'log', message: `  - Selecting: ${optionText}` });
                const initialUrl = page.url();
                const buttonSelector = `//div[contains(@class, "_tagContent_")]/div[normalize-space()="${optionText}"]`;
                const [button] = await page.$x(buttonSelector);

                if (!button) {
                    sendUpdate({ type: 'log', message: `    - Warning: Button "${optionText}" not found. Skipping.` });
                    return null;
                }
                
                await button.click();
                
                try {
                    await page.waitForFunction(url => window.location.href !== url, { timeout: 5000 }, initialUrl);
                    const newUrl = page.url();
                    const id = newUrl.split('/').pop();
                    sendUpdate({ type: 'log', message: `    - Found ID: ${id}` });
                    return id;
                } catch (e) {
                    sendUpdate({ type: 'error', message: `URL did not change for "${optionText}". It might be the default.` });
                    return initialUrl.split('/').pop();
                }
            }

            const itemTypes = ['Ordinary', 'Neon', 'Mega Neon'];
            const properties = {
                'Base': [],
                'Flyable (F)': ['Flyable'],
                'Rideable (R)': ['Rideable'],
                'Flyable & Rideable (FR)': ['Flyable', 'Rideable']
            };
            const ordinaryAges = ['Newborn', 'Junior', 'Pre-Teen', 'Teen', 'Post-Teen', 'Full Grown'];
            const neonAges = ['Reborn', 'Twinkle', 'Sparkle', 'Flare', 'Sunshine', 'Luminous'];

            for (const itemType of itemTypes) {
                await selectOptionAndGetId(itemType);
                for (const propName in properties) {
                    const propsToClick = properties[propName];
                    for (const prop of propsToClick) await selectOptionAndGetId(prop);

                    const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);

                    if (ages.length > 0) {
                        for (const age of ages) {
                            const id = await selectOptionAndGetId(age);
                            const combination = `${itemType} ${propName} ${petTitle}, Age: ${age}`;
                            if (id) {
                                sendUpdate({ type: 'data', payload: { combination, id } });
                                collectedData.push({ combination, id });
                            }
                            await selectOptionAndGetId(age); // De-select
                        }
                    } else { // Mega Neon case
                        const url = page.url();
                        const id = url.split('/').pop();
                        const combination = `${itemType} ${propName} ${petTitle}`;
                        if (id) {
                            sendUpdate({ type: 'data', payload: { combination, id } });
                            collectedData.push({ combination, id });
                        }
                    }
                    for (const prop of propsToClick) await selectOptionAndGetId(prop); // De-select
                }
            }

            sendUpdate({ type: 'log', message: `Collection complete. Found ${collectedData.length} total combinations.` });

        } catch (error) {
            console.error('Scraper error:', error);
            sendUpdate({ type: 'error', message: error.message });
        } finally {
            if (browser) await browser.close();
            sendUpdate({ type: 'log', message: 'Process complete. Closing connection.' });
            res.end();
        }
    };

    runScraper();
    req.on('close', () => {
        console.log('Client closed connection');
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
