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
        setTimeout(() => delete jobs[jobId], 120000);
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
            protocolTimeout: 240000, // **NEW:** Increase timeout to 4 minutes to prevent crash
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

        // --- **NEW** High-Speed "Click and Watch" Logic ---
        
        async function getButtonState(propName) {
            const buttonSelector = `//a[.//p[normalize-space()="${propName}"]]`;
            const [button] = await page.$x(buttonSelector);
            if (!button) return null;
            return await button.evaluate(node => node.querySelector('div[class*="_selected_"]') !== null);
        }

        async function clickButtonByText(text) {
            const buttonSelector = `//a[.//p[normalize-space()="${text}"]]`;
            const [button] = await page.$x(buttonSelector);
            if (!button) {
                addLog(`  - WARN: Button "${text}" not found.`, false);
                return;
            }
            
            const initialState = await getButtonState(text);
            await button.click();

            // Actively wait for the button's visual state to change. This is much faster than waiting for URL.
            try {
                await page.waitForFunction(
                    (selector, expectedState) => {
                        const element = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (!element) return false;
                        const isSelected = element.querySelector('div[class*="_selected_"]') !== null;
                        return isSelected === expectedState;
                    },
                    { timeout: 2000 }, // Short 2-second timeout
                    buttonSelector,
                    !initialState
                );
            } catch (e) {
                addLog(`  - Note: State for "${text}" did not visually change after click.`);
            }
        }
        
        const allCombinations = [];
        const itemTypes = ['Ordinary', 'Neon', 'Mega Neon'];
        const properties = {
            'Base': { flyable: false, rideable: false },
            'Flyable (F)': { flyable: true, rideable: false },
            'Rideable (R)': { flyable: false, rideable: true },
            'Flyable & Rideable (FR)': { flyable: true, rideable: true }
        };
        const ordinaryAges = ['Newborn', 'Junior', 'Pre-Teen', 'Teen', 'Post-Teen', 'Full Grown'];
        const neonAges = ['Reborn', 'Twinkle', 'Sparkle', 'Flare', 'Sunshine', 'Luminous'];

        itemTypes.forEach(itemType => {
            for (const propName in properties) {
                const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);
                if (ages.length > 0) {
                    ages.forEach(age => {
                        allCombinations.push({ itemType, propName, properties: properties[propName], age });
                    });
                } else {
                    allCombinations.push({ itemType, propName, properties: properties[propName], age: null });
                }
            }
        });

        for (const target of allCombinations) {
            const combinationName = `${target.itemType} ${target.propName} ${petTitle}${target.age ? ', Age: ' + target.age : ''}`;
            addLog(`Setting state for: "${combinationName}"`);

            if (!(await getButtonState(target.itemType))) await clickButtonByText(target.itemType);
            if (await getButtonState('Flyable') !== target.properties.flyable) await clickButtonByText('Flyable');
            if (await getButtonState('Rideable') !== target.properties.rideable) await clickButtonByText('Rideable');
            if (target.age && !(await getButtonState(target.age))) await clickButtonByText(target.age);

            const isItemTypeCorrect = await getButtonState(target.itemType);
            const isFlyableCorrect = await getButtonState('Flyable') === target.properties.flyable;
            const isRideableCorrect = await getButtonState('Rideable') === target.properties.rideable;
            const isAgeCorrect = target.age ? await getButtonState(target.age) : true;
            
            if (isItemTypeCorrect && isFlyableCorrect && isRideableCorrect && isAgeCorrect) {
                const id = page.url().split('/').pop();
                addLog(`  - State confirmed. ID: ${id}`);
                addData({ combination: combinationName, id });
            } else {
                addLog(`  - ERROR: State confirmation failed for "${combinationName}". Skipping.`, true);
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
