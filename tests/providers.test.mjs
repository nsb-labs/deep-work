import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseJsonResult, invocation, wslPath } = require('../service/providers/cli.cjs');
const { runProcess } = require('../service/providers/process.cjs');

test('CLI output rejects terminal chatter and accepts one JSON response', () => {
  assert.deepEqual(parseJsonResult('```json\n{"text":"ok"}\n```'), { text: 'ok' });
  assert.throws(() => parseJsonResult('Ready!\n{"text":"ok"}'), /single JSON/);
});
test('native argument vectors preserve user paths without shell interpolation', () => {
  const launch = invocation(
    { provider: 'kiro', execution: 'native', executable: 'C:\\Tools with spaces\\kiro-cli.exe' },
    ['chat', '--no-interactive'],
    'C:\\Work',
  );
  assert.equal(launch.command, 'C:\\Tools with spaces\\kiro-cli.exe');
  assert.deepEqual(launch.args, ['chat', '--no-interactive']);
  assert.equal(wslPath('C:\\Work space\\jobs'), '\/mnt/c/Work space/jobs');
  assert.throws(
    () => invocation({ provider: 'codex', executable: 'codex.cmd' }, [], '.'),
    /shell launchers/,
  );
});
test('process runner passes prompt data through stdin without executing it', async () => {
  const input = '$(do not execute) & <mail> `literal`';
  const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
    input,
  });
  assert.equal(result.stdout, input);
});
test('process timeout and cancellation reject instead of hanging', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 20 }),
    /timed out/,
  );
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(promise, /Cancelled/);
});

test('process output preserves Unicode split across byte chunks', async () => {
  const result = await runProcess(process.execPath, [
    '-e',
    'process.stdout.write(Buffer.from([0xe2])); setTimeout(()=>process.stdout.write(Buffer.from([0x82,0xac])),30)',
  ]);
  assert.equal(result.stdout, '€');
});

test('Kiro JSON event adapter reads final assistant content and rejects interrupted runs', () => {
  const { parseKiroResult } = require('../service/providers/cli.cjs');
  const raw = [
    { type: 'metadata', data: { meteringUsage: [] } },
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '{"text":"summary","changes":[],"facts":[]}' }] },
    },
  ]
    .map(JSON.stringify)
    .join('\n');
  assert.equal(parseKiroResult(raw).text, 'summary');
  assert.throws(() => parseKiroResult(JSON.stringify({ type: 'interrupted' })), /interrupted/);
});
