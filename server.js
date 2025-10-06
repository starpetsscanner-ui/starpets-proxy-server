const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Endpoint to fetch pet data from the new API endpoint
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
        await page.setViewport({ width: 1920, height: 1080 });
        
        console.log(`Navigating to ${starPetsUrl}...`);
        page.goto(starPetsUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

        console.log('Waiting for the new target API response: market.apineural.com...');
        // **THE FIX:** We are now targeting the new API endpoint we discovered.
        const apiResponse = await page.waitForResponse(
            response => response.url().includes('market.apineural.com/api/store/items/all') && response.status() === 200,
            { timeout: 60000 }
        );

        console.log('API response captured! Parsing JSON...');
        const jsonData = await apiResponse.json();
        
        // The structure of the new API response is unknown, so we'll check for common patterns.
        const pets = jsonData.items || jsonData.data || (Array.isArray(jsonData) ? jsonData : null);

        if (pets && Array.isArray(pets)) {
            console.log(`Successfully retrieved ${pets.length} pets.`);
            res.status(200).json({ success: true, pets: pets });
        } else {
            console.error('Could not find a pet array in the response. Full response:', jsonData);
            throw new Error('Could not parse the pet items from the new API response.');
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