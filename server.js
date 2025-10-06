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
    const starPetsMarketUrl = 'https://starpets.pw/market?game=adp&orderBy=price&order=asc';

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
            // This is the target API endpoint the website calls
            if (url.includes('api/v2/market/inventory')) {
                try {
                    apiData = await response.json();
                } catch (e) {
                    console.error('Failed to parse JSON from response:', e);
                }
            }
        });

        console.log(`Navigating to ${starPetsMarketUrl}...`);
        await page.goto(starPetsMarketUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        if (apiData) {
            console.log('Successfully captured API data.');
            res.json(apiData);
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
    console.log(`Server is running on port ${PORT}`);
});