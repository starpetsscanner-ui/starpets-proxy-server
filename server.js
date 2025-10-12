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

// This new endpoint will stream status updates
app.post('/api/collect-pet-ids-stream', (req, res) => {
    const { petName } = req.body;

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush the headers to establish the connection

    // Helper function to send updates to the client
    const sendUpdate = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Main scraping logic wrapped in an async function
    const runScraper = async () => {
        let browser = null;
        try {
            if (!petName) {
                throw new Error('Pet name is required.');
            }

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
            sendUpdate({ type: 'log', message: 'Waiting for pet sales page to load...' });
            await page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 });

            sendUpdate({ type: 'log', message: 'On sales page. Starting ID collection...' });

            // ... [The complex 52-combination scraping logic would go here] ...
            // For now, as a test, let's just grab the first ID.
            const initialUrl = page.url();
            const initialId = initialUrl.split('/').pop();
            const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent);
            
            sendUpdate({ type: 'data', payload: { combination: `Default ${petTitle}`, id: initialId } });
            
            // Simulate finding more IDs for demonstration
            sendUpdate({ type: 'log', message: 'Simulating finding more combinations...' });
            await new Promise(resolve => setTimeout(resolve, 1000)); // fake delay
            sendUpdate({ type: 'data', payload: { combination: `Neon ${petTitle}`, id: parseInt(initialId) + 1 } });

            sendUpdate({ type: 'log', message: 'Collection process finished.' });

        } catch (error) {
            console.error('Scraper error:', error);
            sendUpdate({ type: 'error', message: error.message });
        } finally {
            if (browser) {
                await browser.close();
            }
            sendUpdate({ type: 'log', message: 'Process complete. Closing connection.' });
            res.end(); // Close the SSE connection
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