const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/pets', async (req, res) => {
    console.log("Received request to fetch pet data...");
    let browser = null;
    const starPetsApiUrl = 'https://starpets.pw/api/v2/market/inventory/?limit=250&offset=0&orderBy=price&order=asc&game=adp';

    try {
        console.log("Launching browser from serverless-chromium...");
        // This is the crucial change: we tell Puppeteer to use the special browser
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        console.log(`Navigating to StarPets API URL...`);
        await page.goto(starPetsApiUrl, { waitUntil: 'networkidle0' });

        const jsonText = await page.evaluate(() => {
            // Check if the content is in a <pre> tag
            const preElement = document.querySelector('pre');
            if (preElement) {
                return preElement.innerText;
            }
            // Fallback for raw JSON pages
            return document.body.innerText;
        });

        console.log("Successfully extracted JSON data.");
        
        const data = JSON.parse(jsonText);
        res.json(data);

    } catch (error) {
        console.error('Server error during headless browser operation:', error);
        res.status(500).json({ message: 'Internal Server Error while fetching data.' });
    } finally {
        if (browser) {
            console.log("Closing browser...");
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});