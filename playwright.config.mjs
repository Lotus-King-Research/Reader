import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.mjs', timeout: 30000, fullyParallel: true, retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', {open: 'never'}]],
  use: {baseURL: process.env.LUKIJA_URL || 'http://127.0.0.1:8788', trace: 'retain-on-failure', acceptDownloads: true,
    launchOptions: process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}},
  projects: [
    {name:'desktop', use:{browserName:'chromium', viewport:{width:1440,height:1000}}},
    {name:'mobile', use:{browserName:'chromium', viewport:{width:390,height:844}, isMobile:true, hasTouch:true}}
  ],
  webServer: process.env.LUKIJA_URL || process.env.LUKIJA_TEST_CONTENT ? undefined : {
    command:'node scripts/serve.mjs', url:'http://127.0.0.1:8788', reuseExistingServer:!process.env.CI
  }
});
