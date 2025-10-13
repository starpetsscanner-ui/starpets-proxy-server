
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { v4: uuidv4 } = require('uuid');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const jobs = {};

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Server is awake.' });
});

app.post('/api/start-collection', (req, res) => {
    const { petName } = req.body;
    const jobId = uuidv4();
    jobs[jobId] = {
        status: 'PENDING',
        logs: [`Job created for "${petName}".`],
        data: [],
    };
    runScraper(jobId, petName);
    res.status(202).json({ jobId });
});

app.get('/api/check-status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    res.status(200).json(job);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        setTimeout(() => delete jobs[req.params.jobId], 120000);
    }
});

const runScraper = async (jobId, petName) => {
    const job = jobs[jobId];
    const addLog = (message, isError = false) => {
        console.log(message);
        job.logs.push(message);
        if (isError) job.status = 'FAILED';
    };
    const addData = (item) => job.data.push(item);

    let browser = null;
    try {
        job.status = 'IN_PROGRESS';
        addLog('Launching browser...');
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--single-process'],
            protocolTimeout: 300000,
        });
        addLog('Browser launched.');

        const page = await browser.newPage();
        addLog('Navigating to StarPets.pw...');
        await page.goto('https://starpets.pw/', { waitUntil: 'networkidle2', timeout: 90000 });

        addLog(`Searching for "${petName}"...`);
        await page.type('input[placeholder="Quick search"]', petName);
        await page.keyboard.press('Enter');
        await page.waitForXPath(`//a[contains(., "${petName}")]`, { timeout: 10000 });
        
        addLog('Clicking pet link...');
        const [petLink] = await page.$x(`//a[contains(., "${petName}")]`);
        if (!petLink) throw new Error(`Could not find a link for "${petName}".`);
        
        await Promise.all([
            petLink.click(),
            page.waitForSelector('h1[class*="_name_"]', { timeout: 10000 })
        ]);
        addLog('On sales page. Starting collection...');
        
        const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent.trim());

        // --- **NEW** High-Speed "Set and Fire" Logic ---
        
        async function getButtonState(text) {
            const selector = `//a[.//p[normalize-space()="${text}"]]`;
            const [button] = await page.$x(selector);
            if (!button) return null;
            return await button.evaluate(node => node.querySelector('div[class*="_selected_"]') !== null);
        }

        async function clickButtonByText(text) {
            const selector = `//a[.//p[normalize-space()="${text}"]]`;
            const [button] = await page.$x(selector);
            if (!button) {
                addLog(`  - WARN: Button "${text}" not found.`, true);
                return;
            }
            await button.click();
            // This short, fixed delay replaces all slow, complex waiting logic.
            await page.waitForTimeout(400); 
        }

        async function setProperties(targetState) {
            if (await getButtonState('Flyable') !== targetState.flyable) {
                addLog(`  - Setting Flyable to ${targetState.flyable}`);
                await clickButtonByText('Flyable');
            }
            if (await getButtonState('Rideable') !== targetState.rideable) {
                addLog(`  - Setting Rideable to ${targetState.rideable}`);
                await clickButtonByText('Rideable');
            }
        }
        
        const itemTypes = ['Ordinary', 'Neon', 'Mega Neon'];
        const properties = {
            'Base': { flyable: false, rideable: false },
            'Flyable (F)': { flyable: true, rideable: false },
            'Rideable (R)': { flyable: false, rideable: true },
            'Flyable & Rideable (FR)': { flyable: true, rideable: true }
        };
        const ordinaryAges = ['Newborn', 'Junior', 'Pre-Teen', 'Teen', 'Post-Teen', 'Full Grown'];
        const neonAges = ['Reborn', 'Twinkle', 'Sparkle', 'Flare', 'Sunshine', 'Luminous'];

        for (const itemType of itemTypes) {
            addLog(`Processing Item Type: ${itemType}`);
            await clickButtonByText(itemType);

            for (const propName in properties) {
                addLog(`  Processing Property: ${propName}`);
                await setProperties(properties[propName]);
                
                const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);
                if (ages.length > 0) {
                    for (const age of ages) {
                        await clickButtonByText(age);
                        const id = page.url().split('/').pop();
                        const combination = `${itemType} ${propName} ${petTitle}, Age: ${age}`;
                        addData({ combination, id });
                    }
                } else { // Mega Neon
                    const id = page.url().split('/').pop();
                    const combination = `${itemType} ${propName} ${petTitle}`;
                    addData({ combination, id });
                }
            }
        }

        addLog('Collection process completed successfully.');
        job.status = 'COMPLETED';

    } catch (error) {
        console.error('Scraper error:', error);
        addLog(`ERROR: ${error.message}`, true);
    } finally {
        if (browser) {
            addLog('Closing browser...');
            await browser.close();
        }
        addLog('Process finished.');
        if (job.status !== 'FAILED') job.status = 'COMPLETED';
    }
};

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});