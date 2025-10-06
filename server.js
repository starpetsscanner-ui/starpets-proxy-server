const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// A single, simple endpoint to test the connection.
app.get('/api/test-connection', async (req, res) => {
    console.log('Received request for /api/test-connection');
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

        console.log('Browser launched. Navigating to page...');
        const page = await browser.newPage();
        await page.goto(starPetsUrl, { waitUntil: 'networkidle2', timeout: 90000 });

        console.log('Page loaded. Getting title...');
        const pageTitle = await page.title();

        if (pageTitle) {
            console.log(`Successfully retrieved title: "${pageTitle}"`);
            res.status(200).json({ success: true, title: pageTitle });
        } else {
            throw new Error('Could not retrieve the page title. The page may not have loaded correctly.');
        }

    } catch (error) {
        console.error('An error occurred during the connection test:', error);
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