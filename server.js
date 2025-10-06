const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// New endpoint to detect and report all network requests
app.get('/api/detect-requests', async (req, res) => {
    console.log('Received request for /api/detect-requests');
    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';

    try {
        console.log('Launching browser...');
        const executablePath = await chromium.executablePath();
        const browserArgs = [
            ...chromium.args,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process'
        ];
        browser = await puppeteer.launch({
            executablePath,
            headless: chromium.headless,
            args: browserArgs,
            ignoreHTTPSErrors: true,
        });

        console.log('Browser launched. Creating new page...');
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const detectedUrls = [];
        // Set up the listener *before* navigating
        page.on('request', request => {
            // We only care about document, script, and data (fetch/xhr) requests for now
            const types = ['document', 'script', 'fetch', 'xhr'];
            if (types.includes(request.resourceType())) {
                 console.log('Detected request:', request.url());
                 detectedUrls.push(request.url());
            }
        });
        
        console.log(`Navigating to ${starPetsUrl}...`);
        // Wait until there are no new network connections for at least 500ms
        await page.goto(starPetsUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        
        console.log('Page has reached network idle. Sending back detected URLs.');

        res.status(200).json({ 
            success: true, 
            count: detectedUrls.length,
            urls: detectedUrls 
        });

    } catch (error) {
        console.error('An error occurred while detecting requests:', error);
        res.status(500).json({ success: false, message: 'An error occurred on the server.', error: error.message });
    } finally {
        if (browser) {
            console.log('Closing browser.');
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});