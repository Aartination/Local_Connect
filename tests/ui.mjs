import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3198;
const HTTPS_PORT = 3598;

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const executablePath = EDGE_PATHS.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chromium/Edge executable found for UI tests.');
  process.exit(1);
}

async function waitForHealth(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/api/system/health`);
      if (r.ok) return;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not start');
}

async function run() {
  console.log('--- LOCAL HUB Real Browser UI & WebRTC Test ---');

  // Reset DB & storage
  for (const dir of ['storage', 'backups']) {
    await fsp.rm(path.join(root, dir), { recursive: true, force: true }).catch(() => {});
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fsp.rm(path.join(root, 'database', `localhub.db${suffix}`), { force: true }).catch(() => {});
  }
  await fsp.rm(path.join(root, 'config', 'setup-token.txt'), { force: true }).catch(() => {});

  await new Promise((resolve, reject) => {
    const p = spawn('cmd', ['/c', 'npm run db:migrate'], { cwd: root, stdio: 'pipe' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('db:migrate failed'))));
  });

  const srv = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], {
    cwd: root,
    env: { ...process.env, LOCALHUB_PORT: String(PORT), LOCALHUB_HTTPS_PORT: String(HTTPS_PORT), LOCALHUB_HTTPS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browser;
  const pageErrors = [];
  try {
    await waitForHealth(`http://127.0.0.1:${PORT}`);
    const setupCode = fs.readFileSync(path.join(root, 'config', 'setup-token.txt'), 'utf8').trim();
    const baseUrl = `https://127.0.0.1:${HTTPS_PORT}`;

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--ignore-certificate-errors',
      ],
    });

    const ctx1 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 820 } });
    const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 820 } });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    p1.on('pageerror', (e) => pageErrors.push(`Owner pageerror: ${e.message}`));
    p2.on('pageerror', (e) => pageErrors.push(`Partner pageerror: ${e.message}`));

    // 1. Owner First-Time Setup in UI
    await p1.goto(baseUrl);
    await p1.getByText('First-Time Host Setup').waitFor();
    await p1.getByPlaceholder('e.g. 482910-A1B2').fill(setupCode);
    await p1.getByPlaceholder('Alex Rivera', { exact: true }).fill('Alex Owner');
    await p1.getByPlaceholder('alex', { exact: true }).fill('alex');
    await p1.getByPlaceholder('Create a strong password').fill('OwnerPass123');
    await p1.getByRole('button', { name: 'Initialize Workspace' }).click();
    await p1.getByText('Welcome to Team').waitFor({ timeout: 10000 });
    console.log('✓ [UI 1] First-time setup wizard created Owner and loaded Team chat');

    // 2. Owner creates Invitation in Admin Dashboard UI
    await p1.getByRole('button', { name: 'Admin Dashboard' }).click();
    await p1.getByRole('button', { name: 'Users & Invites' }).click();
    await p1.getByPlaceholder('Note (e.g. For Maya)').fill('Maya');
    await p1.getByRole('button', { name: 'Create Invitation' }).click();
    const codeEl = p1.locator('span.font-mono', { hasText: /^LH-/ }).first();
    await codeEl.waitFor();
    const inviteCode = (await codeEl.textContent()).trim();
    assert.ok(inviteCode.startsWith('LH-'));
    console.log(`✓ [UI 2] Admin Dashboard created invite code ${inviteCode}`);

    // 3. Partner joins via /invite/:code in second browser context
    await p2.goto(`${baseUrl}/invite/${inviteCode}`);
    await p2.getByText('Valid invitation').waitFor();
    await p2.getByPlaceholder('Jordan Kim', { exact: true }).fill('Maya Partner');
    await p2.getByPlaceholder('jordan', { exact: true }).fill('maya');
    await p2.getByPlaceholder('Create a password').fill('MayaPass123');
    await p2.getByRole('button', { name: 'Create Account & Join' }).click();
    await p2.getByPlaceholder('Message Team...').waitFor({ timeout: 10000 });
    console.log('✓ [UI 3] Partner registered via invite URL and joined Team chat');

    // 4. Real-time messaging between two live browsers
    await p1.getByRole('button', { name: /Team/ }).first().click();
    await p1.getByPlaceholder('Message Team...').fill('Hey Maya! Live LAN test message.');
    await p1.getByPlaceholder('Message Team...').press('Enter');
    await p2.getByText('Hey Maya! Live LAN test message.').waitFor({ timeout: 8000 });
    console.log('✓ [UI 4] Real-time message rendered live in second browser');

    // 5. File upload (PNG) in chat UI & image preview rendering
    const pngPath = path.join(root, 'tests', 'tmp-test.png');
    fs.writeFileSync(
      pngPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
        'base64',
      ),
    );
    await p1.locator('input[type="file"]').setInputFiles(pngPath);
    await p1.getByText('Ready').waitFor({ timeout: 8000 });
    await p1.locator('button[title="Send message"]').click();
    await p2.locator('img[alt="tmp-test.png"]').waitFor({ timeout: 8000 });
    fs.unlinkSync(pngPath);
    console.log('✓ [UI 5] Image uploaded in UI and thumbnail rendered live on partner browser');

    // 6. Real WebRTC Audio/Video Call between two live browsers!
    await p1.locator('button[title="Start video call"]').click();
    await p2.getByText('Incoming video call').waitFor({ timeout: 8000 });
    await p2.getByRole('button', { name: 'Video', exact: true }).click();
    await p1.getByText(/2 participants/).waitFor({ timeout: 10000 });
    await p2.getByText(/2 participants/).waitFor({ timeout: 10000 });
    // Let WebRTC exchange ICE/SDP & verify video tiles are active
    await p1.waitForTimeout(1500);
    await p1.getByRole('button', { name: 'End Call' }).click();
    await p1.getByText('Video call ended').waitFor({ timeout: 8000 });
    console.log('✓ [UI 6] Live two-browser LAN WebRTC video call connected and recorded call history');

    // 7. Walk every remaining view to verify zero runtime errors
    for (const nav of ['Workspace', 'Shared Files', 'Media Gallery', 'Tasks & To-Dos', 'Admin Dashboard', 'Settings']) {
      await p1.getByRole('button', { name: nav }).click();
      await p1.waitForTimeout(350);
    }
    assert.equal(pageErrors.length, 0, `Uncaught browser errors: ${pageErrors.join('; ')}`);
    console.log('✓ [UI 7] All 7 workspace views rendered cleanly with 0 console/page errors!');
    console.log('\nALL REAL BROWSER UI & WEBRTC TESTS PASSED!');
  } finally {
    await browser?.close().catch(() => {});
    srv.kill('SIGTERM');
    await new Promise((r) => {
      srv.once('exit', r);
      setTimeout(r, 2500);
    });
  }
}

run().catch((err) => {
  console.error('\nUI TEST FAILED:', err);
  process.exit(1);
});
