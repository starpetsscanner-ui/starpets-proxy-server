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
        petName: petName,
        logs: [`Job created for "${petName}".`],
        data: [],
    };
    runScraper(jobId);
    res.status(202).json({ jobId: jobId, message: 'Collection job started.' });
});

app.get('/api/check-status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs[jobId];
    if (!job) {
        return res.status(404).json({ message: 'Job not found.' });
    }
    res.status(200).json(job);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        setTimeout(() => delete jobs[jobId], 60000);
    }
});

const runScraper = async (jobId) => {
    const job = jobs[jobId];
    const { petName } = job;
    
    const addLog = (message, isError = false) => {
        console.log(message);
        job.logs.push(message);
        if(isError) job.status = 'FAILED';
    };
    const addData = (item) => job.data.push(item);

    let browser = null;
    try {
        job.status = 'IN_PROGRESS';
        addLog('Launching stealth browser...');
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--single-process'],
        });
        addLog('Browser launched.');

        const page = await browser.newPage();
        addLog('Navigating to StarPets.pw...');
        await page.goto('https://starpets.pw/', { waitUntil: 'networkidle2', timeout: 90000 });

        addLog(`Searching for "${petName}"...`);
        await page.type('input[placeholder="Quick search"]', petName);
        await page.keyboard.press('Enter');
        await page.waitForXPath(`//a[contains(., "${petName}")]`, { timeout: 30000 });
        
        addLog('Clicking pet link...');
        const [petLink] = await page.$x(`//a[contains(., "${petName}")]`);
        if (!petLink) throw new Error(`Could not find a link for "${petName}".`);
        
        await Promise.all([
            petLink.click(),
            page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 })
        ]);
        addLog('On sales page. Starting collection...');
        
        const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent.trim());

        // **NEW STATE MANAGEMENT LOGIC**
        const currentState = { flyable: false, rideable: false };

        async function getButtonState(propName) {
            const buttonSelector = `//a[.//p[normalize-space()="${propName}"]]`;
            const [button] = await page.$x(buttonSelector);
            if(!button) return false; // Assume not selected if not found
            return await button.evaluate(node => node.querySelector('div[class*="_selected_"]') !== null);
        }

        async function setPropertyState(targetState) {
            // Update Flyable if needed
            if (currentState.flyable !== targetState.flyable) {
                addLog(`  - Toggling Flyable to: ${targetState.flyable}`);
                await clickOption('Flyable');
                currentState.flyable = targetState.flyable;
            }
             // Update Rideable if needed
            if (currentState.rideable !== targetState.rideable) {
                addLog(`  - Toggling Rideable to: ${targetState.rideable}`);
                await clickOption('Rideable');
                currentState.rideable = targetState.rideable;
            }
        }

        async function clickOption(optionText) {
             const buttonSelector = `//a[.//p[normalize-space()="${optionText}"]]`;
             const [button] = await page.$x(buttonSelector);
             if(!button) {
                 addLog(`  - Button "${optionText}" not found.`, true);
                 return;
             }
             await button.click();
             await page.waitForTimeout(300); // Short wait for UI to update
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
        
        // Get initial state
        currentState.flyable = await getButtonState('Flyable');
        currentState.rideable = await getButtonState('Rideable');
        addLog(`Initial state: Flyable=${currentState.flyable}, Rideable=${currentState.rideable}`);

        for (const itemType of itemTypes) {
            addLog(`Processing Item Type: ${itemType}`);
            await clickOption(itemType);
            for (const propName in properties) {
                addLog(`  Processing Property: ${propName}`);
                const targetState = properties[propName];
                await setPropertyState(targetState);
                
                const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);
                if (ages.length > 0) {
                    for (const age of ages) {
                        await clickOption(age);
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