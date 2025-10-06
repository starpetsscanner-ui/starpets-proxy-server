const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// New endpoint specifically for fetching pet data
app.get('/api/get-pets', async (req, res) => {
    console.log('Received request for /api/get-pets');
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
        
        console.log(`Navigating to ${starPetsUrl}...`);
        // We initiate navigation but don't wait for the page to be fully idle.
        page.goto(starPetsUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

        console.log('Waiting for the pet data API response...');
        // This is the key step: we explicitly wait for the network request that contains the pet data.
        const apiResponse = await page.waitForResponse(
            response => response.url().includes('api/v1/trade-cards/list') && response.status() === 200,
            { timeout: 60000 } // Wait up to 60 seconds for this specific API call
        );

        console.log('API response captured! Parsing JSON...');
        const jsonData = await apiResponse.json();
        const pets = jsonData.items;

        if (pets && Array.isArray(pets)) {
            console.log(`Successfully retrieved ${pets.length} pets.`);
            res.status(200).json({ success: true, pets: pets });
        } else {
            throw new Error('Could not parse the pet items from the API response.');
        }

    } catch (error) {
        console.error('An error occurred while fetching pet data:', error);
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
