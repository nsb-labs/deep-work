import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runProcess } = require('../service/providers/process.cjs');
const { outlookRequest } = require('../service/connectors/outlook.cjs');
test(
  'Outlook helper parses under Windows PowerShell',
  { skip: process.platform !== 'win32' },
  async () => {
    const helper = fileURLToPath(new URL('../service/connectors/outlook.ps1', import.meta.url));
    const validator = fileURLToPath(new URL('./fixtures/validate-powershell.ps1', import.meta.url));
    const result = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', validator, '-SourcePath', helper],
      { timeout: 15000 },
    );
    assert.match(result.stdout, /syntax verified/);
  },
);
test(
  'live Outlook rejects unsupported hosts without launching a shell',
  { skip: process.platform === 'win32' },
  async () => {
    await assert.rejects(
      outlookRequest({ operation: 'sync' }, '.', 'missing.ps1'),
      /Windows with classic Outlook/,
    );
  },
);
