const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies

// New endpoint to search for a specific pet
app.post('/api/search-pet', async (req, res) => {
    const { petName } = req.body;
    console.log(`Received request to search for pet: "${petName}"`);
    
    if (!petName) {
        return res.status(400).json({ success: false, message: 'Pet name is required.' });
    }

    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';
    const searchBarSelector = 'input[placeholder="Quick search"]';

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
        
        console.log('Page loaded. Finding the search bar...');
        await page.waitForSelector(searchBarSelector, { timeout: 30000 });
        console.log('Search bar found. Typing pet name...');

        // Type the pet name into the search bar and press Enter
        await page.type(searchBarSelector, petName);
        await page.keyboard.press('Enter');
        
        console.log(`Successfully searched for "${petName}".`);
        
        // For now, we just confirm the action was completed.
        // In the next step, we'll capture the results after this navigation.
        res.status(200).json({ success: true, message: `Successfully initiated search for "${petName}".` });

    } catch (error) {
        console.error('An error occurred during the search operation:', error);
        if (error.name === 'TimeoutError') {
             res.status(500).json({ success: false, message: `Could not find the search bar to perform the search.` });
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
