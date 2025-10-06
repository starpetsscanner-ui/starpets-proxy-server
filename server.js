const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/pets', async (req, res) => {
    console.log('API Endpoint /api/pets hit. Starting process...');
    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';

    try {
        console.log('Getting executable path from chromium library...');
        const executablePath = await chromium.executablePath();
        
        console.log('Attempting to launch Puppeteer...');
        const browserArgs = [
            ...chromium.args,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process'
        ];

        browser = await puppeteer.launch({
            executablePath: executablePath,
            headless: chromium.headless,
            args: browserArgs,
            ignoreHTTPSErrors: true,
        });

        console.log('Browser launched successfully. Opening new page...');
        const page = await browser.newPage();
        
        console.log(`Navigating to ${starPetsUrl}...`);
        // We go to the page but don't wait for it to be fully idle yet.
        page.goto(starPetsUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

        console.log('Page navigation initiated. Explicitly waiting for the API response...');
        
        // **THE FIX:** Instead of a flaky 'response' listener, we explicitly wait for the correct API call.
        // This is much more reliable and avoids race conditions.
        const apiResponse = await page.waitForResponse(
            response => response.url().includes('api/v1/trade-cards/list') && response.status() === 200,
            { timeout: 60000 } // Wait for up to 60 seconds for the API call to happen
        );

        console.log('Target API response successfully captured!');
        const jsonData = await apiResponse.json();
        const apiData = jsonData.items;

        if (apiData) {
            console.log('Successfully parsed and sending API data.');
            res.json({ items: apiData });
        } else {
            // This case should be much rarer now.
            console.error('API data was captured but was empty. Throwing error.');
            throw new Error('API response was captured, but it contained no item data.');
        }

    } catch (error) {
        console.error('An error occurred during the browser operation:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
            console.log('Browser closed.');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});