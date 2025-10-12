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

// This is our stable "base build" endpoint. We will keep it for testing.
app.post('/api/search-pet', async (req, res) => {
    // ... [The existing, stable code from our base build remains here] ...
    const { petName } = req.body;
    console.log(`Received request to search for pet: "${petName}"`);
    if (!petName) { return res.status(400).json({ success: false, message: 'Pet name is required.' }); }
    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';
    const searchBarSelector = 'input[placeholder="Quick search"]';
    const petNameHeaderSelector = 'h1[class*="_name_"]';
    try {
        browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), headless: chromium.headless, args: [...chromium.args, '--no-sandbox'], ignoreHTTPSErrors: true });
        const page = await browser.newPage();
        await page.goto(starPetsUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        console.log('Page loaded. Finding search bar and typing pet name...');
        await page.type(searchBarSelector, petName);
        console.log('Pressing Enter and waiting for search results to appear...');
        await page.keyboard.press('Enter');
        const resultsContainerSelector = 'div[class*="_container_"]'; 
        await page.waitForSelector(resultsContainerSelector, { timeout: 30000 });
        console.log('Search results page loaded. Finding link for the pet...');
        const petLinkSelector = `//a[contains(., "${petName}")]`;
        const [petLink] = await page.$x(petLinkSelector);
        if (!petLink) { throw new Error(`Could not find a link for "${petName}" on the search results page.`); }
        console.log('Pet link found. Clicking and waiting for the pet sales page...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            petLink.click(),
        ]);
        console.log('Pet sales page loaded. Verifying pet name...');
        await page.waitForSelector(petNameHeaderSelector, { timeout: 15000 });
        const finalUrl = page.url();
        console.log(`Verification complete. Landed on URL: ${finalUrl}`);
        res.status(200).json({ success: true, message: `Verification successful. Landed on URL: ${finalUrl}` });
    } catch (error) {
        console.error('An error occurred during the search and navigation process:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (browser) { await browser.close(); }
    }
});

// **NEW:** Endpoint for collecting all 52 IDs
app.post('/api/collect-pet-ids', async (req, res) => {
    const { petName } = req.body;
    console.log(`Starting full ID collection for: "${petName}"`);
    if (!petName) { return res.status(400).json({ success: false, message: 'Pet name is required.' }); }

    let browser = null;
    try {
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
            ignoreHTTPSErrors: true,
        });
        const page = await browser.newPage();

        // --- Start of our stable "base build" logic ---
        await page.goto('https://starpets.pw/', { waitUntil: 'networkidle2', timeout: 90000 });
        await page.type('input[placeholder="Quick search"]', petName);
        await page.keyboard.press('Enter');
        await page.waitForSelector('div[class*="_container_"]', { timeout: 30000 });
        const [petLink] = await page.$x(`//a[contains(., "${petName}")]`);
        if (!petLink) throw new Error(`Could not find a link for "${petName}".`);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            petLink.click(),
        ]);
        await page.waitForSelector('h1[class*="_name_"]', { timeout: 30000 });
        console.log(`On the main sales page for ${petName}. Beginning ID collection.`);
        // --- End of base build logic ---

        const petTitle = await page.$eval('h1[class*="_name_"]', el => el.textContent);
        const collectedData = [];

        async function selectOptionAndGetId(optionText) {
            console.log(`  - Clicking: ${optionText}`);
            const initialUrl = page.url();
            
            // **THE FIX:** This new XPath selector targets the <a> link based on the <p> text inside it, ignoring whitespace.
            const buttonSelector = `//a[.//p[normalize-space()="${optionText}"]]`;
            
            const [button] = await page.$x(buttonSelector);
            if (!button) {
                console.log(`    - Warning: Button "${optionText}" not found. Skipping.`);
                return null;
            }
            await button.click();
            try {
                await page.waitForFunction(url => window.location.href !== url, { timeout: 5000 }, initialUrl);
            } catch (e) {
                console.log(`    - URL did not change for "${optionText}". It might be the default or already selected.`);
            }
            const newUrl = page.url();
            return newUrl.split('/').pop();
        }

        const itemTypes = ['Ordinary', 'Neon', 'Mega Neon'];
        const properties = {
            'Base': [],
            'Flyable (F)': ['Flyable'],
            'Rideable (R)': ['Rideable'],
            'Flyable & Rideable (FR)': ['Flyable', 'Rideable']
        };
        const ordinaryAges = ['Newborn', 'Junior', 'Pre-Teen', 'Teen', 'Post-Teen', 'Full Grown'];
        const neonAges = ['Reborn', 'Twinkle', 'Sparkle', 'Flare', 'Sunshine', 'Luminous'];

        for (const itemType of itemTypes) {
            await selectOptionAndGetId(itemType);
            for (const propName in properties) {
                const propsToClick = properties[propName];
                for (const prop of propsToClick) await selectOptionAndGetId(prop);

                const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);
                if (ages.length > 0) {
                    for (const age of ages) {
                        const id = await selectOptionAndGetId(age);
                        const combination = `${itemType} ${propName} ${petTitle}, Age: ${age}`;
                        if (id) collectedData.push({ combination, id });
                        await selectOptionAndGetId(age); // De-select age
                    }
                } else {
                    const id = page.url().split('/').pop();
                    const combination = `${itemType} ${propName} ${petTitle}`;
                    if (id) collectedData.push({ combination, id });
                }
                for (const prop of propsToClick.slice().reverse()) await selectOptionAndGetId(prop); // De-select properties
            }
        }
        
        console.log(`Collection complete. Found ${collectedData.length} combinations.`);
        res.status(200).json({ success: true, data: collectedData });

    } catch (error) {
        console.error('An error occurred during full ID collection:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (browser) await browser.close();
    }
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
