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

// Main endpoint to scrape all 52 pet IDs
app.post('/api/collect-pet-ids', async (req, res) => {
    const { petName } = req.body;
    console.log(`Starting ID collection for: "${petName}"`);
    if (!petName) {
        return res.status(400).json({ success: false, message: 'Pet name is required.' });
    }

    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';
    const searchBarSelector = 'input[placeholder="Quick search"]';

    try {
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.goto(starPetsUrl, { waitUntil: 'networkidle2', timeout: 90000 });

        // 1. Search for the pet and navigate to its page
        console.log(`Searching for ${petName}...`);
        await page.type(searchBarSelector, petName);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.keyboard.press('Enter'),
        ]);

        console.log('On search results page, finding and clicking link...');
        const petLinkSelector = `//a[contains(., "${petName}")]`;
        const [petLink] = await page.$x(petLinkSelector);
        if (!petLink) throw new Error(`Could not find a link for "${petName}".`);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            petLink.click(),
        ]);
        console.log(`On the main sales page for ${petName}.`);

        // Helper function to click a button and wait for URL to change
        async function clickAndWaitForUrlChange(buttonText) {
            const initialUrl = page.url();
            console.log(`  Clicking button: "${buttonText}"...`);
            const buttonSelector = `//div[contains(@class, "_tagContent_")]/div[contains(text(), "${buttonText}")]`;
            const [button] = await page.$x(buttonSelector);
            if (!button) {
                console.log(`    - Warning: Button "${buttonText}" not found. Skipping.`);
                return null;
            }
            await button.click();
            // Wait until the URL is different from the initial one
            await page.waitForFunction(url => window.location.href !== url, {}, initialUrl);
            const newUrl = page.url();
            const id = newUrl.split('/').pop();
            console.log(`    - New ID found: ${id}`);
            return id;
        }

        const collectedData = [];
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
            await clickAndWaitForUrlChange(itemType);

            for (const propName in properties) {
                const propsToClick = properties[propName];
                
                // Click properties
                if (propsToClick.length > 0) {
                     for(const prop of propsToClick) await clickAndWaitForUrlChange(prop);
                }

                const ages = itemType === 'Ordinary' ? ordinaryAges : (itemType === 'Neon' ? neonAges : []);

                if (ages.length > 0) {
                    for (const age of ages) {
                        const id = await clickAndWaitForUrlChange(age);
                        if (id) {
                            collectedData.push({ combination: `${itemType} ${propName} ${petName}, Age: ${age}`, id });
                        }
                        await clickAndWaitForUrlChange(age); // De-select age
                    }
                } else { // Handle Mega Neon (no age)
                    const url = page.url();
                    const id = url.split('/').pop();
                    if(id) {
                        collectedData.push({ combination: `${itemType} ${propName} ${petName}`, id });
                    }
                }

                // De-select properties
                 if (propsToClick.length > 0) {
                     for(const prop of propsToClick) await clickAndWaitForUrlChange(prop);
                }
            }
        }
        
        console.log(`Collection complete. Found ${collectedData.length} combinations.`);
        res.status(200).json({ success: true, data: collectedData });

    } catch (error) {
        console.error('An error occurred during ID collection:', error);
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

