const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/api/search-pet', async (req, res) => {
    const { petName } = req.body;
    console.log(`Received request to find and verify page for: "${petName}"`);
    
    if (!petName) {
        return res.status(400).json({ success: false, message: 'Pet name is required.' });
    }

    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';
    const searchBarSelector = 'input[placeholder="Quick search"]';
    // This is a selector for the h1 tag on the final pet page. 
    // We use a partial class match `[class*="_name_"]` because the full class name is dynamic.
    const petNameHeaderSelector = 'h1[class*="_name_"]';


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

        const page = await browser.newPage();
        await page.goto(starPetsUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        
        console.log('Page loaded. Finding search bar and typing pet name...');
        await page.type(searchBarSelector, petName);
        
        console.log('Pressing Enter and waiting for search results to appear...');
        // **THE FIX:** Instead of waiting for a full page navigation, which doesn't happen,
        // we now just press Enter and then wait for the results container to appear on the page.
        await page.keyboard.press('Enter');
        
        // This selector targets a div whose class name contains "_container_", matching the one you found.
        const resultsContainerSelector = 'div[class*="_container_"]'; 
        await page.waitForSelector(resultsContainerSelector, { timeout: 30000 });
        
        console.log('Search results page loaded. Finding link for the pet...');
        // We'll use an XPath selector to find the first link that contains the pet's name.
        // This is more robust than relying on dynamic class names.
        const petLinkSelector = `//a[contains(., "${petName}")]`;
        const [petLink] = await page.$x(petLinkSelector);

        if (!petLink) {
            throw new Error(`Could not find a link for "${petName}" on the search results page.`);
        }
        
        console.log('Pet link found. Clicking and waiting for the pet sales page...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            petLink.click(),
        ]);

        console.log('Pet sales page loaded. Verifying pet name...');
        // Wait for the h1 header to be visible on the page
        await page.waitForSelector(petNameHeaderSelector, { timeout: 15000 });
        const finalPetName = await page.$eval(petNameHeaderSelector, el => el.textContent);

        console.log(`Verification complete. Found name: "${finalPetName}"`);
        res.status(200).json({ 
            success: true, 
            message: `Successfully navigated to the page for: ${finalPetName}` 
        });

    } catch (error) {
        console.error('An error occurred during the search and navigation process:', error);
        res.status(500).json({ success: false, message: error.message });
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



