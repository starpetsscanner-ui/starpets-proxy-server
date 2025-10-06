const express = require('express');
const cors = require('cors');
// Use puppeteer-extra to wrap puppeteer-core and add plugins
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// This library finds the installed chrome on cloud environments
const chromium = require('@sparticuz/chromium');

// Apply the stealth plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/pets', async (req, res) => {
    console.log('Received request to fetch pet data...');
    let browser = null;
    // The API call happens on the homepage, not the market page specifically
    const starPetsUrl = 'https://starpets.pw/';

    try {
        console.log('Launching stealth browser...');

        // Use the chromium library to get the correct path and args
        const executablePath = await chromium.executablePath();
        
        browser = await puppeteer.launch({
            executablePath: executablePath,
            headless: chromium.headless, // Use the recommended headless mode
            args: chromium.args,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Intercept network requests to find the API call we want
        let apiData = null;
        page.on('response', async (response) => {
            const url = response.url();
            // This is the updated target API endpoint from your HAR file
            if (url.includes('api/v1/trade-cards/list')) {
                try {
                    const jsonData = await response.json();
                    // The actual items are nested under a 'items' key in the response
                    apiData = jsonData.items; 
                } catch (e) {
                    console.error('Failed to parse JSON from response:', e);
                }
            }
        });

        console.log(`Navigating to ${starPetsUrl}...`);
        await page.goto(starPetsUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        if (apiData) {
            console.log('Successfully captured API data.');
            // We now send the apiData directly since it's already the array of items
            res.json({ items: apiData });
        } else {
            throw new Error('Could not capture the market inventory API data from the page.');
        }

    } catch (error) {
        console.error('Server error during stealth browser operation:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
