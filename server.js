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

// --- API Endpoints (Job Polling System) ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Server is awake.' });
});

app.post('/api/start-collection', (req, res) => {
    const { petName } = req.body;
    const jobId = uuidv4();
    jobs[jobId] = {
        status: 'PENDING',
        logs: [`Job created for "${petName}".`],
        data: null, // Will hold the final map of IDs
    };
    runScraper(jobId, petName);
    res.status(202).json({ jobId });
});

app.get('/api/check-status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    res.status(200).json(job);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        setTimeout(() => delete jobs[req.params.jobId], 60000);
    }
});

// --- **NEW** "Scrape, Don't Click" Scraper Logic ---
const runScraper = async (jobId, petName) => {
    const job = jobs[jobId];
    const addLog = (message, isError = false) => {
        console.log(message);
        job.logs.push(message);
        if (isError) job.status = 'FAILED';
    };

    let browser = null;
    try {
        job.status = 'IN_PROGRESS';
        addLog('Launching browser...');
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
        addLog('On sales page. Scraping all variant links at once...');

        // This is the core of the new strategy.
        // We run a script inside the browser to grab all the data we need in one go.
        const attributeIdMap = await page.evaluate(() => {
            const idMap = {};
            // Select all link elements within the attribute containers
            const links = document.querySelectorAll('div[class*="_tagContent_"] a');
            
            links.forEach(link => {
                const textElement = link.querySelector('p');
                if (textElement) {
                    const attributeName = textElement.textContent.trim();
                    const href = link.getAttribute('href');
                    if (attributeName && href) {
                        const id = href.split('/').pop();
                        idMap[attributeName] = id;
                    }
                }
            });
            return idMap;
        });

        if (Object.keys(attributeIdMap).length === 0) {
            throw new Error('Could not scrape any attribute IDs from the page.');
        }

        addLog(`Successfully scraped ${Object.keys(attributeIdMap).length} unique attribute IDs.`);
        job.data = attributeIdMap;
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
