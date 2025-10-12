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
        setTimeout(() => delete jobs[jobId], 120000); // Clean up after 2 minutes
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
    const updateData = (index, updates) => {
        if(job.data[index]) {
            job.data[index] = { ...job.data[index], ...updates };
        }
    };

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

        // --- Core Scraping Functions with Retry Logic ---
        async function clickButtonByText(text, retries = 3) {
            for (let i = 0; i < retries; i++) {
                const buttonSelector = `//a[.//p[normalize-space()="${text}"]]`;
                const [button] = await page.$x(buttonSelector);
                if (button) {
                    await button.click();
                    await page.waitForTimeout(500); // Wait for UI to update
                    return true;
                }
                addLog(`  - Retry ${i+1}/${retries}: Button "${text}" not found. Waiting...`);
                await page.waitForTimeout(1000);
            }
            addLog(`  - ERROR: Failed to find button "${text}" after ${retries} retries.`, true);
            return false; // Return false instead of throwing error to continue process
        }

        async function getButtonState(propName) {
            const buttonSelector = `//a[.//p[normalize-space()="${propName}"]]`;
            const [button] = await page.$x(buttonSelector);
            if (!button) return false;
            return await button.evaluate(node => node.querySelector('div[class*="_selected_"]') !== null);
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
                        addLog(`    - Clicking Age: ${age}`);
                        await clickButtonByText(age);
                        const id = page.url().split('/').pop();
                        const combination = `${itemType} ${propName} ${petTitle}, Age: ${age}`;
                        job.data.push({ combination, id, verified: null }); // Add to job data immediately
                    }
                } else { // Mega Neon
                    const id = page.url().split('/').pop();
                    const combination = `${itemType} ${propName} ${petTitle}`;
                    job.data.push({ combination, id, verified: null });
                }
            }
        }
        
        addLog(`Initial collection complete. Starting verification and correction phase...`);

        // --- **UPGRADED** Verification and Correction Phase ---
        for (let i = 0; i < job.data.length; i++) {
            const item = job.data[i];
            const petUrlName = petTitle.toLowerCase().replace(/ /g, '_');
            const url = `https://starpets.pw/shop/pet/${petUrlName}/${item.id}`;
            addLog(`Verifying: "${item.combination}"...`);
            await page.goto(url, { waitUntil: 'networkidle2' });

            const expected = {
                itemType: item.combination.includes('Ordinary') ? 'Ordinary' : item.combination.includes('Neon') ? 'Neon' : 'Mega Neon',
                flyable: item.combination.includes('Flyable (F)') || item.combination.includes('Flyable & Rideable (FR)'),
                rideable: item.combination.includes('Rideable (R)') || item.combination.includes('Flyable & Rideable (FR)'),
                age: item.combination.split('Age: ')[1] || null
            };

            const isCorrect = (await getButtonState(expected.itemType)) &&
                              (await getButtonState('Flyable') === expected.flyable) &&
                              (await getButtonState('Rideable') === expected.rideable) &&
                              (expected.age ? await getButtonState(expected.age) : true);

            if (isCorrect) {
                addLog(`  - OK.`);
                updateData(i, { verified: true });
            } else {
                addLog(`  - Mismatch found. Attempting self-correction...`);
                await clickButtonByText(expected.itemType);
                await setProperties({ flyable: expected.flyable, rideable: expected.rideable });
                if (expected.age) {
                    await clickButtonByText(expected.age);
                }
                const correctedId = page.url().split('/').pop();
                addLog(`  - Correction complete. New ID is ${correctedId}.`);
                updateData(i, { id: correctedId, verified: true });
            }
        }

        addLog('Verification and correction complete.');
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