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

// Health check endpoint to wake up the server on Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Server is awake.' });
});

// New streaming endpoint for collecting IDs
app.post('/api/collect-pet-ids-stream', (req, res) => {
    const { petName } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendUpdate = (data) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };

    const runScraper = async () => {
        let browser = null;
        try {
            if (!petName) throw new Error('Pet name is required.');

            sendUpdate({ type: 'log', message: 'Launching stealth browser...' });
            browser = await puppeteer.launch({
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--single-process'],
            });
            sendUpdate({ type: 'log', message: 'Browser launched.' });

            const page = await browser.newPage();
            sendUpdate({ type: 'log', message: 'Navigating to StarPets.pw...' });
            await page.goto('https://starpets.pw/', { waitUntil: 'networkidle2', timeout: 90000 });

            sendUpdate({ type: 'log', message: `Searching for "${petName}"...` });
            await page.type('input[placeholder="Quick search"]', petName);
            await page.keyboard.press('Enter');
            await page.waitForSelector('div[class*="_container_"]', { timeout: 30000 });

            sendUpdate({ type: 'log', message: 'Clicking pet link...' });
            const [petLink] = await page.$x(`//a[contains(., "${petName}")]`);
            if (!petLink) throw new Error(`Could not find a link for "${petName}".`);
            
            await Promise.all([
                petLink.click(),
                page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 })
            ]);
            sendUpdate({ type: 'log', message: 'On sales page. Starting collection...' });
            
            const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent.trim());

            async function clickOption(optionText) {
                const buttonSelector = `//a[.//p[normalize-space()="${optionText}"]]`;
                const [button] = await page.$x(buttonSelector);
                if (!button) {
                    sendUpdate({ type: 'log', message: `  - Button "${optionText}" not found. Skipping.` });
                    return false;
                }
                const isSelected = await button.evaluate(node => node.querySelector('div[class*="_selected_"]') !== null);
                if (isSelected) {
                    sendUpdate({ type: 'log', message: `  - "${optionText}" is already selected.` });
                    return true;
                }
                sendUpdate({ type: 'log', message: `  - Clicking "${optionText}"...` });
                await button.click();
                await page.waitForTimeout(500); // Wait for JS to update
                return true;
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
            
            // Start with a clean slate
            await clickOption('Ordinary');

            for (const itemType of itemTypes) {
                await clickOption(itemType);
                for (const propName in properties) {
                    const propsToClick = properties[propName];
                    for (const prop of propsToClick) await clickOption(prop);
                    
                    const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);
                    if (ages.length > 0) {
                        for (const age of ages) {
                            if (await clickOption(age)) {
                                const id = page.url().split('/').pop();
                                const combination = `${itemType} ${propName} ${petTitle}, Age: ${age}`;
                                sendUpdate({ type: 'data', payload: { combination, id } });
                            }
                        }
                    } else { // Mega Neon
                        const id = page.url().split('/').pop();
                        const combination = `${itemType} ${propName} ${petTitle}`;
                        sendUpdate({ type: 'data', payload: { combination, id } });
                    }
                    // Deselect properties
                    for (const prop of propsToClick) await clickOption(prop);
                }
            }
            sendUpdate({ type: 'success', message: 'Collection process completed successfully.' });

        } catch (error) {
            console.error('Scraper error:', error);
            sendUpdate({ type: 'error', message: error.message });
        } finally {
            if (browser) {
                sendUpdate({ type: 'log', message: 'Closing browser...' });
                await browser.close();
            }
            sendUpdate({ type: 'log', message: 'Process finished. Closing connection.' });
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