const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// New endpoint to check for the presence of the search bar
app.get('/api/check-search-bar', async (req, res) => {
    console.log('Received request for /api/check-search-bar');
    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';
    // This is a CSS selector that looks for an input field whose placeholder contains "Search"
    const searchBarSelector = 'input[placeholder*="Search"]';

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
        console.log('Page loaded. Looking for the quick search bar...');

        // Wait for the selector to appear on the page. If it doesn't appear within the timeout, it will throw an error.
        await page.waitForSelector(searchBarSelector, { timeout: 30000 });

        console.log('Success! Quick search bar was found on the page.');
        res.status(200).json({ success: true, message: 'Quick search bar was found.' });

    } catch (error) {
        console.error('An error occurred during the check:', error);
        // Provide a specific error message if it was a timeout
        if (error.name === 'TimeoutError') {
             res.status(500).json({ success: false, message: `Failed to find the search bar (${searchBarSelector}) within the time limit.` });
        } else {
             res.status(500).json({ success: false, message: 'An unknown server error occurred.', error: error.message });
        }
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

