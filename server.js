const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// This new endpoint will stream status updates
app.get('/api/pets-stream', async (req, res) => {
    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Helper function to send status updates to the client
    const sendStatus = (message, data = null) => {
        const eventData = JSON.stringify({ message, data });
        res.write(`data: ${eventData}\n\n`);
    };
    
    let browser = null;
    const starPetsUrl = 'https://starpets.pw/';

    try {
        sendStatus('API Endpoint hit. Starting process...');
        
        sendStatus('Getting executable path...');
        const executablePath = await chromium.executablePath();
        
        sendStatus('Attempting to launch Puppeteer...');
        const browserArgs = [ ...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process' ];
        browser = await puppeteer.launch({
            executablePath,
            headless: chromium.headless,
            args: browserArgs,
            ignoreHTTPSErrors: true,
        });

        sendStatus('Browser launched. Opening new page...');
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36');
        
        sendStatus(`Navigating to ${starPetsUrl}...`);
        page.goto(starPetsUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

        sendStatus('Page navigation initiated. Waiting for API response...');
        const apiResponse = await page.waitForResponse(
            response => response.url().includes('api/v1/trade-cards/list') && response.status() === 200,
            { timeout: 80000 }
        );

        sendStatus('API response captured! Parsing data...');
        const jsonData = await apiResponse.json();
        const apiData = jsonData.items;

        if (apiData) {
            sendStatus('Successfully parsed data. Sending final result.', apiData);
        } else {
            throw new Error('API response was captured, but it contained no item data.');
        }

    } catch (error) {
        console.error('An error occurred during the stream:', error);
        sendStatus(`Error: ${error.message}. Check server logs for details.`);
    } finally {
        if (browser) {
            sendStatus('Closing browser...');
            await browser.close();
        }
        sendStatus('Process complete. Closing connection.');
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});