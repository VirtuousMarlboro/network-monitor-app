/**
 * E2E Tests for Floating Windows and Traffic Modal
 * Uses Puppeteer for browser automation
 */

const puppeteer = require('puppeteer');

describe('E2E: Floating Windows', () => {
    let browser;
    let page;
    const APP_URL = process.env.TEST_URL || 'http://localhost:1234';

    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
    });

    afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    describe('Login Flow', () => {
        test('should display login form', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            // Check if login form or dashboard is visible
            const loginForm = await page.$('#loginForm, #loginModal');
            const dashboard = await page.$('#dashboard, .dashboard');

            expect(loginForm || dashboard).toBeTruthy();
        });
    });

    describe('Floating Window Container', () => {
        test('should have floating windows container', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const container = await page.$('#floatingWindowsContainer');
            expect(container).toBeTruthy();
        });
    });

    describe('Traffic Modal', () => {
        test('should have traffic modal in DOM', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const trafficModal = await page.$('#trafficModal');
            expect(trafficModal).toBeTruthy();
        });

        test('should have time filter controls', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const periodSelect = await page.$('#trafficPeriodSelect');
            const fromDate = await page.$('#trafficFromDate');
            const toDate = await page.$('#trafficToDate');

            expect(periodSelect).toBeTruthy();
            expect(fromDate).toBeTruthy();
            expect(toDate).toBeTruthy();
        });

        test('should have navigation buttons', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const prevBtn = await page.$('#trafficPrevBtn');
            const nextBtn = await page.$('#trafficNextBtn');
            const applyBtn = await page.$('#trafficApplyBtn');

            expect(prevBtn).toBeTruthy();
            expect(nextBtn).toBeTruthy();
            expect(applyBtn).toBeTruthy();
        });

        test('should have statistics display elements', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const inCurrent = await page.$('#trafficInCurrent');
            const inAverage = await page.$('#trafficInAverage');
            const inMaximum = await page.$('#trafficInMaximum');
            const outCurrent = await page.$('#trafficOutCurrent');
            const outAverage = await page.$('#trafficOutAverage');
            const outMaximum = await page.$('#trafficOutMaximum');

            expect(inCurrent).toBeTruthy();
            expect(inAverage).toBeTruthy();
            expect(inMaximum).toBeTruthy();
            expect(outCurrent).toBeTruthy();
            expect(outAverage).toBeTruthy();
            expect(outMaximum).toBeTruthy();
        });
    });
});

describe('E2E: UI Elements', () => {
    let browser;
    let page;
    const APP_URL = process.env.TEST_URL || 'http://localhost:1234';

    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();
    });

    afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });

    describe('Page Load', () => {
        test('should load page without errors', async () => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));

            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            // Check for critical errors (allow some non-critical)
            const criticalErrors = errors.filter(e =>
                !e.includes('favicon') &&
                !e.includes('ResizeObserver')
            );

            expect(criticalErrors.length).toBe(0);
        });

        test('should have Chart.js loaded', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const chartLoaded = await page.evaluate(() => {
                return typeof Chart !== 'undefined';
            });

            expect(chartLoaded).toBe(true);
        });
    });

    describe('Modals', () => {
        test('should have ping modal', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const pingModal = await page.$('#pingModal');
            expect(pingModal).toBeTruthy();
        });

        test('should have traceroute modal', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2' });

            const tracerouteModal = await page.$('#tracerouteModal');
            expect(tracerouteModal).toBeTruthy();
        });
    });
});
