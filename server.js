const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/pets', async (req, res) => {
    console.log('Received request to fetch pet data...');
    let browser = null;

    try {
        console.log('Launching browser...');
        // The new library provides the correct executable path and arguments
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        
        // Go to a non-API page first to appear more like a real user
        await page.goto('https://starpets.pw/market', { waitUntil: 'networkidle0' });

        console.log('Navigating to API URL to capture JSON...');
        const starPetsApiUrl = 'https://starpets.pw/api/v2/market/inventory/?limit=250&offset=0&orderBy=price&order=asc&game=adp';
        const response = await page.goto(starPetsApiUrl);
        
        console.log('Request successful, parsing JSON...');
        const data = await response.json();
        
        res.json(data);

    } catch (error) {
        console.error('Server error during headless browser operation:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        if (browser !== null) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});