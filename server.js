const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// This is the endpoint your app will call
app.get('/api/pets', async (req, res) => {
    console.log("Received request to fetch pet data...");
    let browser = null;
    const starPetsApiUrl = 'https://starpets.pw/api/v2/market/inventory/?limit=250&offset=0&orderBy=price&order=asc&game=adp';

    try {
        // Launch the browser. The '--no-sandbox' flag is crucial for many server environments like Render.
        console.log("Launching headless browser...");
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Set a realistic user agent to mimic a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        console.log(`Navigating to StarPets API URL...`);
        // Go to the API URL. The browser will handle cookies, JS challenges, etc.
        await page.goto(starPetsApiUrl, { waitUntil: 'networkidle0' });

        // The content of the page should be the JSON data
        const content = await page.content();
        
        // The raw content is HTML with the JSON inside a <pre> tag. We need to extract it.
        const jsonText = await page.evaluate(() => {
            return document.querySelector('pre').innerText;
        });

        console.log("Successfully extracted JSON data.");
        
        // Parse the extracted text as JSON
        const data = JSON.parse(jsonText);
        
        // Send the data back to the user's app
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
