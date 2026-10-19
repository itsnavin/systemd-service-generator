import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('accessible controls, responsive layout and local-only generation', async ({ page }) => {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== new URL(test.info().project.use.baseURL || process.env.BASE_URL || 'http://127.0.0.1:4173').origin) external.push(request.url());
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Give your process');
  await expect(page.getByRole('button', { name: /Download .service/ })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Service name *', { exact: true }).fill('sensor-app');
  await expect(page.locator('#filename')).toHaveText('sensor-app.service');
  await page.getByRole('button', { name: 'Add argument' }).click();
  await page.getByRole('textbox', { name: 'Argument 1', exact: true }).fill('a "quoted" $HOME %n ;');
  await expect(page.locator('#preview')).toContainText('"a \\"quoted\\" $HOME %%n ;"');
  await page.getByLabel('Service name *', { exact: true }).fill('../bad');
  await expect(page.getByRole('alert')).toContainText('Use 1-64');
  await expect(page.getByRole('button', { name: /Download .service/ })).toBeDisabled();
  await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('alert').getByRole('link').click();
  await expect(page.locator('#name')).toBeFocused();
  await page.locator('#name').fill('sensor-app');
  await page.getByRole('button', { name: 'Remove argument 1' }).click();
  await expect(page.getByRole('button', { name: 'Add argument' })).toBeFocused();
  expect(errors).toEqual([]);
  const injected = process.platform === 'win32' ? external.filter(url => new URL(url).hostname === 'local.adguard.org') : [];
  if (injected.length) console.warn('Host AdGuard injected requests into this browser; CI verifies app-only requests on clean Ubuntu.');
  expect(external.filter(url => !injected.includes(url))).toEqual([]);
});

test('recipes, system/user settings, root warning and oneshot constraints', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Python script/ }).click();
  await expect(page.locator('#executable')).toHaveValue('/usr/bin/python3');
  await expect(page.getByRole('textbox', { name: 'Argument 2', exact: true })).toHaveValue('/opt/my-app/main.py');
  await page.getByLabel('Run as', { exact: true }).selectOption('system');
  await expect(page.getByRole('alert')).toContainText('existing lowercase');
  await page.getByLabel('Existing user *', { exact: true }).fill('root');
  await expect(page.getByRole('alert')).toContainText('Explicitly confirm root');
  await page.locator('#allowRoot').check();
  await page.getByText('Optional system-service hardening', { exact: true }).click();
  await page.locator('#privateTmp').check();
  await expect(page.locator('#preview')).toContainText('PrivateTmp=yes');
  await expect(page.locator('#instructions')).toContainText('sudo systemctl');
  await page.locator('#mode').selectOption('user');
  await expect(page.locator('#preview')).not.toContainText('PrivateTmp=');
  await expect(page.locator('#preview')).not.toContainText('User=');
  await expect(page.locator('#instructions')).toContainText('systemctl --user');
  await page.getByRole('button', { name: /One-time task/ }).click();
  await page.locator('#remainAfterExit').check();
  await expect(page.locator('#preview')).toContainText('RemainAfterExit=yes');
  await page.locator('#restart').selectOption('always');
  await expect(page.getByRole('alert')).toContainText('oneshot cannot');
  await page.locator('#restart').selectOption('no');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('download bytes exactly match preview and correct filename', async ({ page }) => {
  await page.goto('./');
  await page.locator('#name').fill('download-test');
  const expected = await page.locator('#preview').textContent();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download .service/ }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('download-test.service');
  expect(await readFile(await download.path(), 'utf8')).toBe(expected);
  expect(expected.endsWith('\n')).toBe(true);
  expect(expected.endsWith('\n\n')).toBe(false);
});

test('clipboard copies exact content and reports denied access without false success', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: value => { window.copiedUnit = value; return write(value); },
    });
  });
  const unit = await page.locator('#preview').textContent();
  await page.getByRole('button', { name: 'Copy unit', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Unit copied to clipboard.');
  expect(await page.evaluate(() => window.copiedUnit)).toBe(unit);
  // Windows clipboard text is normalized by the browser to native CRLF.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(process.platform === 'win32' ? clipboard.replace(/\r\n/g, '\n') : clipboard).toBe(unit);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')) });
  });
  await page.getByRole('button', { name: 'Copy unit', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Clipboard access failed');
  await expect(page.getByRole('textbox', { name: 'Manual unit copy' })).toBeFocused();
  expect(await page.locator('#manual-copy').evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd))).toBe(unit);
});

test('environment rows, literal values, dependencies and timeout validation', async ({ page }) => {
  await page.goto('./');
  await page.getByText('Timeouts, dependencies & environment', { exact: true }).click();
  await page.getByRole('button', { name: 'Add variable' }).click();
  await page.getByRole('textbox', { name: 'Variable 1 name' }).fill('APP_MODE');
  await page.getByRole('textbox', { name: 'Variable 1 value' }).fill('value $HOME %n "quoted"');
  await expect(page.locator('#preview')).toContainText('Environment="APP_MODE=value $HOME %%n \\"quoted\\""');
  await page.locator('#after').fill('network-online.target');
  await expect(page.getByRole('alert')).toContainText('system manager');
  await page.locator('#after').fill('other.service');
  await page.locator('#timeoutStart').fill('0');
  await expect(page.getByRole('alert')).toContainText('Start timeout');
  await page.locator('#timeoutStart').fill('60');
  await expect(page.locator('#preview')).toContainText('TimeoutStartSec=60s');
  await page.getByRole('button', { name: 'Remove variable 1' }).click();
  await expect(page.locator('#preview')).not.toContainText('Environment=');
});
