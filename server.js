const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { v4: uuidv4 } = require('uuid'); // To generate unique job IDs

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory store for our jobs. In a real production app, you might use a database.
const jobs = {};

// Health check endpoint remains the same
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Server is awake.' });
});

// **STEP 1: New endpoint to START the scraping job**
app.post('/api/start-collection', (req, res) => {
    const { petName } = req.body;
    const jobId = uuidv4();

    // Store the initial job state
    jobs[jobId] = {
        status: 'PENDING',
        petName: petName,
        logs: [`Job created for "${petName}".`],
        data: [],
    };

    // Start the scraper in the background and DO NOT wait for it to finish
    runScraper(jobId);

    // Immediately respond with the jobId
    res.status(202).json({ jobId: jobId, message: 'Collection job started.' });
});

// **STEP 2: New endpoint to CHECK the status of the job**
app.get('/api/check-status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs[jobId];

    if (!job) {
        return res.status(404).json({ message: 'Job not found.' });
    }

    res.status(200).json(job);

    // If the job is complete or failed, we can clean it up after a while
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        setTimeout(() => delete jobs[jobId], 60000); // Clean up after 1 minute
    }
});


// Main scraping logic, now as a background function
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
        await page.waitForSelector('div[class*="_container_"]', { timeout: 30000 });

        addLog('Clicking pet link...');
        const [petLink] = await page.$x(`//a[contains(., "${petName}")]`);
        if (!petLink) throw new Error(`Could not find a link for "${petName}".`);
        
        await Promise.all([
            petLink.click(),
            page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 })
        ]);
        addLog('On sales page. Starting collection...');
        
        const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent.trim());

        async function clickOption(optionText) {
            // ... [This function's logic remains the same as the previous correct version]
            const buttonSelector = `//a[.//p[normalize-space()="${optionText}"]]`;
            const [button] = await page.$x(buttonSelector);
            if (!button) {
                addLog(`  - Button "${optionText}" not found. Skipping.`);
                return false;
            }
            const isSelected = await button.evaluate(node => node.querySelector('div[class*="_selected_"]') !== null);
            if (isSelected) {
                addLog(`  - "${optionText}" is already selected.`);
                return true;
            }
            addLog(`  - Clicking "${optionText}"...`);
            await button.click();
            await page.waitForTimeout(500);
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
        
        await clickOption('Ordinary');

        for (const itemType of itemTypes) {
            await clickOption(itemType);
            for (const propName in properties) {
                for (const prop of properties[propName]) await clickOption(prop);
                
                const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);
                if (ages.length > 0) {
                    for (const age of ages) {
                        if (await clickOption(age)) {
                            const id = page.url().split('/').pop();
                            const combination = `${itemType} ${propName} ${petTitle}, Age: ${age}`;
                            addData({ combination, id });
                        }
                    }
                } else {
                    const id = page.url().split('/').pop();
                    const combination = `${itemType} ${propName} ${petTitle}`;
                    addData({ combination, id });
                }
                for (const prop of properties[propName]) await clickOption(prop);
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