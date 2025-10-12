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

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Server is awake.' });
});

app.post('/api/collect-pet-ids-stream', (req, res) => {
    const { petName } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendUpdate = (data) => {
        // Ensure the connection is still open before writing
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };

    const runScraper = async () => {
        let browser = null;
        try {
            if (!petName) throw new Error('Pet name is required.');

            sendUpdate({ type: 'log', message: 'Configuring browser for Render environment...' });
            const executablePath = await chromium.executablePath();

            sendUpdate({ type: 'log', message: 'Launching stealth browser...' });
            browser = await puppeteer.launch({
                executablePath,
                headless: chromium.headless,
                args: [
                    ...chromium.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--single-process' // Crucial for low-memory environments
                ],
                ignoreHTTPSErrors: true,
            });
            sendUpdate({ type: 'log', message: 'Browser launched successfully.' });


            const page = await browser.newPage();
            sendUpdate({ type: 'log', message: 'Navigating to StarPets.pw...' });
            await page.goto('https://starpets.pw/', { waitUntil: 'networkidle2', timeout: 90000 });
            sendUpdate({ type: 'log', message: 'Homepage loaded.' });


            sendUpdate({ type: 'log', message: `Typing "${petName}" into search bar...` });
            await page.type('input[placeholder="Quick search"]', petName);

            sendUpdate({ type: 'log', message: 'Pressing Enter and waiting for results...' });
            await page.keyboard.press('Enter');

            // **THE FIX:** Instead of waiting for a generic container, we now wait specifically
            // for the link containing the pet's name. This is much more reliable.
            const petLinkSelector = `//a[contains(., "${petName}")]`;
            await page.waitForXPath(petLinkSelector, { timeout: 30000 });
            sendUpdate({ type: 'log', message: 'Search results detected on page.' });

            sendUpdate({ type: 'log', message: 'Finding and clicking pet link...' });
            const [petLink] = await page.$x(petLinkSelector);
            if (!petLink) throw new Error(`Could not find a link for "${petName}" on the results page.`);

            // Click and wait for the final page to load by watching for the H1 tag
            await Promise.all([
                petLink.click(),
                page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 })
            ]);
            sendUpdate({ type: 'log', message: 'Successfully navigated to the pet sales page.' });

            const finalPetName = await page.$eval('h1[class*="_name_"]', el => el.textContent);
            const finalUrl = page.url(); // Get the URL of the current page
            sendUpdate({ type: 'success', message: `Verification complete! Landed on page for "${finalPetName}" at URL: ${finalUrl}` });


        } catch (error) {
            console.error('Scraper error:', error);
            sendUpdate({ type: 'error', message: error.message });
        } finally {
            if (browser) {
                sendUpdate({ type: 'log', message: 'Closing browser...' });
                await browser.close();
            }
            sendUpdate({ type: 'log', message: 'Process complete. Closing connection.' });
            res.end();
        }
    };

    runScraper();

    req.on('close', () => {
        console.log('Client closed connection');
        res.end(); // Ensure the response is ended when the client disconnects
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});