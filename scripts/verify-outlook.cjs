// Explicit live read-only smoke check. Never logs bodies or calls an AI provider.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { outlookRequest } = require('../service/connectors/outlook.cjs');
(async () => {
  if (process.platform !== 'win32')
    throw new Error('Run this check on Windows with classic Outlook.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-outlook-check-'));
  try {
    const helper = path.join(__dirname, '../service/connectors/outlook.ps1');
    const folders = await outlookRequest({ operation: 'folders' }, root, helper);
    console.log(`Classic Outlook connected; ${folders.folders.length} default folders discovered.`);
    const scan = await outlookRequest(
      {
        operation: 'sync',
        lookbackDays: 1,
        maxMessages: 5,
        folders: [],
        trackedThreads: [],
        cursor: {},
      },
      root,
      helper,
    );
    console.log(
      `Read ${scan.messages.length} messages. ${scan.warnings.length} scan warnings. No bodies displayed; no AI invoked.`,
    );
    for (const warning of scan.warnings) console.log(warning);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
