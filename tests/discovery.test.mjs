import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { discoverCli, nativeCandidates } = require('../service/providers/discovery.cjs');
const { runProcess } = require('../service/providers/process.cjs');
const options = {
  platform: 'win32',
  env: {
    PATH: '"C:\\Tools with spaces";C:\\Tools with spaces;.;',
    APPDATA: 'C:\\Users\\Me\\AppData\\Roaming',
  },
  readdir: () => ['codex-win32-x64'],
};
test('Windows discovery finds native and both npm layouts without shell launchers or cwd', () => {
  const files = new Set([
    'C:\\Tools with spaces\\kiro-cli.exe',
    'C:\\Tools with spaces\\codex.cmd',
    'C:\\Users\\Me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe',
    'C:\\Tools with spaces\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe',
  ]);
  const found = nativeCandidates({ ...options, isFile: (file) => files.has(file) });
  assert.equal(found.length, 3);
  assert.equal(found.filter((c) => c.provider === 'codex').length, 2);
  assert.ok(found.every((c) => c.executable.endsWith('.exe')));
});
test('WSL discovery preserves distributions and paths with spaces as argument values', async () => {
  const calls = [];
  const result = await discoverCli({
    ...options,
    isFile: () => false,
    run: async (command, args, limits) => {
      calls.push({ command, args, limits });
      if (args[0] === '--list') return { stdout: 'Ubuntu Work\r\nBroken\r\n' };
      if (args[1] === 'Broken') throw new Error('unavailable');
      if (args.includes('/bin/sh'))
        return {
          stdout: 'codex\t/home/me/CLI tools/codex\nkiro-cli\t/home/me/.local/bin/kiro-cli\n',
        };
      assert.equal(args[1], 'Ubuntu Work');
      assert.equal(args.at(-1), '--version');
      return { stdout: 'version 1.2.3' };
    },
  });
  assert.equal(result.installations.length, 2);
  assert.equal(result.installations[0].wslDistribution, 'Ubuntu Work');
  assert.ok(result.installations.some((c) => c.executable === '/home/me/CLI tools/codex'));
  assert.ok(result.diagnostics.some((s) => s.includes('Broken')));
  assert.ok(calls.every((c) => c.command === 'wsl.exe'));
  assert.equal(calls[0].limits.stdoutEncoding, 'utf16le');
});
test('native results survive unavailable WSL and broken version checks', async () => {
  const result = await discoverCli({
    ...options,
    isFile: (file) => /Tools with spaces\\(codex|kiro-cli)\.exe$/.test(file),
    run: async (command, args) => {
      if (command === 'wsl.exe' || command.endsWith('kiro-cli.exe')) throw new Error('unavailable');
      assert.deepEqual(args, ['--version']);
      return { stdout: 'codex 1.2' };
    },
  });
  assert.equal(result.installations.length, 1);
  assert.equal(result.installations[0].provider, 'codex');
  assert.equal(result.diagnostics.length, 2);
});
test('process runner decodes WSL UTF-16 output including non-ASCII distribution names', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', "process.stdout.write(Buffer.from('Ubuntu 日本語\\r\\n','utf16le'))"],
    { stdoutEncoding: 'utf16le' },
  );
  assert.equal(result.stdout, 'Ubuntu 日本語\r\n');
});
