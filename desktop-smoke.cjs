// Development smoke test of the actual main/preload/service/renderer wiring.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-desktop-'));
process.env.DEEPWORK_WORKSPACE = root;
require('./dist-electron/main.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  let window;
  for (let i = 0; i < 100; i++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading() && window.webContents.getURL()) break;
    await wait(100);
  }
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const result = await window.webContents.executeJavaScript(`(async()=>{
    if(!window.workAPI)throw new Error('Sandboxed preload API missing');
    const before=await window.workAPI.request('snapshot');
    if(before.tasks.length)throw new Error('Smoke workspace not empty');
    await window.workAPI.request('sync');
    return true;
  })()`);
  let snapshot;
  for (let i = 0; i < 100; i++) {
    snapshot = await window.webContents.executeJavaScript("window.workAPI.request('snapshot')");
    if (
      snapshot.tasks.length === 3 &&
      !snapshot.jobs.some((j) => ['running', 'queued'].includes(j.status))
    )
      break;
    await wait(100);
  }
  if (snapshot.tasks.length !== 3) throw new Error('Demo processing did not produce 3 tasks');
  await wait(2200);
  const visible = await window.webContents.executeJavaScript('document.body.innerText');
  if (!visible.includes('Prepare launch readiness update')) throw new Error('Tasks not rendered');
  await window.webContents.executeJavaScript(
    "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Prepare launch readiness update')).click()",
  );
  await wait(300);
  const detail = await window.webContents.executeJavaScript('document.body.innerText');
  if (!detail.includes('Task conversation') || !detail.includes('Draft a reply'))
    throw new Error('Task chat not rendered');
  await window.webContents.executeJavaScript(
    `window.__chatEvents=[];window.workAPI.onChatEvent(e=>window.__chatEvents.push(e));document.querySelector('.chat-starters button').click()`,
  );
  for (let i = 0; i < 100; i++) {
    const done = await window.webContents.executeJavaScript(
      `window.__chatEvents.some(e=>e.status==='completed')`,
    );
    if (done) break;
    await wait(100);
  }
  await wait(500);
  const chatCheck = await window.webContents.executeJavaScript(
    `({text:document.querySelector('.task-chat').innerText,events:window.__chatEvents})`,
  );
  if (
    !chatCheck.text.includes('Demo response') ||
    chatCheck.events.filter((e) => e.status === 'running').length < 2
  )
    throw new Error('Chat did not stream/render');
  const chatSnapshot = await window.webContents.executeJavaScript(
    "window.workAPI.request('snapshot')",
  );
  const chatJob = chatSnapshot.jobs.find((j) => j.operation === 'chat');
  if (!chatJob || chatJob.status !== 'succeeded') throw new Error('Chat job not completed');
  const savedChat = await window.webContents.executeJavaScript(
    `window.workAPI.request('readTask',${JSON.stringify(snapshot.tasks.find((t) => t.title === 'Prepare launch readiness update').id)})`,
  );
  if (savedChat.conversation.length !== 2) throw new Error('Task chat not saved');
  const checkTheme = async (theme) => {
    const actual = await window.webContents.executeJavaScript(`(async () => ({
      theme: document.querySelector('.work-app').dataset.theme,
      scheme: getComputedStyle(document.querySelector('.work-app')).colorScheme,
      saved: (await window.workAPI.request('snapshot')).settings.theme
    }))()`);
    if (actual.theme !== theme || actual.scheme !== theme || actual.saved !== theme)
      throw new Error('Theme not applied or saved: ' + JSON.stringify(actual));
  };
  await checkTheme('dark');
  await window.webContents.executeJavaScript(
    `document.querySelector('[aria-label="Switch to light theme"]').click()`,
  );
  await wait(500);
  await checkTheme('light');
  fs.writeFileSync(
    path.join(os.tmpdir(), 'deepwork-desktop-light.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await wait(500);
  await checkTheme('light');
  await window.webContents.executeJavaScript(
    `document.querySelector('[aria-label="Switch to dark theme"]').click()`,
  );
  await wait(500);
  await checkTheme('dark');
  await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('.work-nav button')].find(b => b.textContent.includes('Settings')).click()`,
  );
  for (let i = 0; i < 100; i++) {
    const detecting = await window.webContents.executeJavaScript(
      `document.body.innerText.includes('Detecting installed CLIs…')`,
    );
    if (!detecting && i > 0) break;
    await wait(100);
  }
  const settingsText = await window.webContents.executeJavaScript('document.body.innerText');
  if (
    !settingsText.includes('Detect installed CLIs') ||
    !settingsText.includes('Detection checks executable versions only.')
  )
    throw new Error('Automatic CLI discovery did not finish in Settings');
  const saved = await window.webContents.executeJavaScript("window.workAPI.request('snapshot')");
  if (saved.settings.provider !== 'demo' || saved.settings.organizationApproved)
    throw new Error('CLI discovery changed saved provider or approval');
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(os.tmpdir(), 'deepwork-desktop.png'), image.toPNG());
  console.log(
    'Desktop smoke passed: sandboxed preload, worker, demo ingestion, task detail, streamed task chat, light/dark switching, and persisted theme after reload, and automatic CLI discovery in Settings.',
  );
  if (errors.length) throw new Error(errors.join('\n'));
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
