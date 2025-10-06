const express = require('express');
const cors = require('cors');
// Use puppeteer-extra to appear more human-like
const puppeteer = require('puppeteer-extra');
// Add the stealth plugin, which helps bypass bot detection
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// Render's free instances have a very small filesystem. We must specify a writable path.
const PUPPETEER_CACHE_DIR = '/dev/shm/.cache/puppeteer';

app.use(cors());

app.get('/api/pets', async (req, res) => {
    console.log('Received request to fetch pet data...');
    let browser = null;
    try {
        console.log('Launching stealth browser...');
        browser = await puppeteer.launch({
            // Use the arguments required for server environments
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certifcate-errors',
                '--ignore-certifcate-errors-spki-list',
                '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"',
            ],
            headless: 'new', // Use the new, more modern headless mode
            executablePath: '/usr/bin/google-chrome', // Render's default Chrome path
            cacheDirectory: PUPPETEER_CACHE_DIR,
        });

        const page = await browser.newPage();
        
        // This is the key: we will wait for the API response instead of navigating to it.
        const apiUrl = 'https://starpets.pw/api/v2/market/inventory/';
        
        console.log('Waiting for API response from the website...');
        const apiResponsePromise = page.waitForResponse(response => 
            response.url().startsWith(apiUrl) && response.status() === 200
        );

        console.log('Navigating to the main market page...');
        await page.goto('https://starpets.pw/market/adp', {
            waitUntil: 'networkidle2', // Wait for the page to be mostly loaded
            timeout: 60000 // Increase timeout to 60 seconds
        });
        
        const apiResponse = await apiResponsePromise;
        const data = await apiResponse.json();

        console.log('Successfully captured API data.');
        res.json(data);

    } catch (error) {
        console.error('Server error during stealth browser operation:', error);
        res.status(500).json({ message: 'Failed to retrieve data using the stealth browser.', error: error.message });
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

