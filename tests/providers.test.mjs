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

test('Codex structured processing exposes progress and answer while preserving schema result validation', async (t) => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const { runCli } = require('../service/providers/cli.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-codex-console-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const progress = [],
    output = [];
  const result = await runCli(
    {
      settings: {
        provider: 'codex',
        execution: 'native',
        organizationApproved: true,
        timeoutSeconds: 10,
      },
    },
    directory,
    null,
    {
      onConsole: (value) => progress.push(value),
      onOutput: (value) => output.push(value),
      run: (_command, args, options) => {
        assert.ok(args.includes('--json'));
        const file = args[args.indexOf('--output-last-message') + 1];
        const script = `process.stdin.resume();process.stdin.on('end',()=>{
        require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify({text:'Summary',changes:[],facts:[]}));
        for(const event of [{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:'Summary'}},{type:'turn.completed'}])process.stdout.write(JSON.stringify(event)+'\\n');});`;
        return runProcess(process.execPath, ['-e', script], options);
      },
    },
  );
  assert.equal(result.text, 'Summary');
  assert.deepEqual(output, ['Summary']);
  assert.ok(progress.includes('Codex: turn started'));
  assert.ok(progress.includes('Codex: turn completed'));
});
