import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AttentionSession } = require('../service/core/attention.cjs');
const { acpProtocol, runKiro } = require('../service/providers/kiro-acp.cjs');
const { runProcess } = require('../service/providers/process.cjs');
const { WorkEngine } = require('../service/core/engine.cjs');
const choices = [
  { optionId: 'yes', name: 'Approve once', kind: 'allow_once' },
  { optionId: 'no', name: 'Deny', kind: 'reject_once' },
];
const permission = {
  sessionId: 's',
  toolCall: { toolCallId: 'tool', title: 'Read file' },
  options: choices,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('permission decisions are single-use, scoped, audited and reject unknown choices', async () => {
  const audit = [];
  const controller = new AbortController();
  const session = new AttentionSession('job', {
    signal: controller.signal,
    onChange() {},
    audit: (v) => audit.push(v),
  });
  const pending = session.request(permission);
  const request = session.snapshot().requests[0];
  assert.throws(
    () => session.decide({ requestId: request.requestId, optionId: 'other' }),
    /invalid/,
  );
  session.decide({ requestId: request.requestId, optionId: 'yes' });
  assert.equal(await pending, 'yes');
  assert.equal(audit.length, 1);
  assert.throws(() => session.decide({ requestId: request.requestId, optionId: 'yes' }), /stale/);
  assert.equal(session.snapshot().requests.length, 0);
});

test('permission cancellation, expiry and process exit release callbacks without granting access', async () => {
  for (const mode of ['abort', 'expire', 'close']) {
    const controller = new AbortController();
    const session = new AttentionSession('job', {
      signal: controller.signal,
      onChange() {},
      audit() {},
      timeout: 10,
    });
    const pending = session.request(permission);
    if (mode === 'abort') controller.abort();
    if (mode === 'close') session.close();
    assert.equal(await pending, null);
    assert.equal(session.snapshot().requests.length, 0);
  }
});

test('ACP routes one-time choices to the original request and rejects unsupported client tools', async () => {
  const sent = [],
    pauses = [],
    answers = [];
  let decide;
  const protocol = acpProtocol('context', 'C:\\Work', {
    emit: (text) => answers.push(text),
    requestPermission: () =>
      new Promise((resolve) => {
        decide = resolve;
      }),
  });
  protocol.start(
    (line) => sent.push(JSON.parse(line)),
    () => {},
    (paused) => pauses.push(paused),
  );
  protocol.event({ id: 1, result: { protocolVersion: 1 } });
  protocol.event({ id: 2, result: { sessionId: 's', modes: { currentModeId: 'deepwork' } } });
  assert.deepEqual(sent[0].params.clientCapabilities, {});
  protocol.event({
    id: 99,
    method: 'session/request_permission',
    params: {
      ...permission,
      options: [...choices, { optionId: 'always', name: 'Trust always', kind: 'allow_always' }],
    },
  });
  await tick();
  assert.equal(sent.length, 3);
  assert.throws(
    () => protocol.event({ id: 99, method: 'session/request_permission', params: permission }),
    /Invalid/,
  );
  decide('yes');
  await tick();
  assert.deepEqual(sent.at(-1), {
    jsonrpc: '2.0',
    id: 99,
    result: { outcome: { outcome: 'selected', optionId: 'yes' } },
  });
  assert.deepEqual(pauses, [true, false]);
  protocol.event({ id: 100, method: 'fs/read_text_file', params: {} });
  assert.equal(sent.at(-1).error.code, -32601);
  protocol.event({
    method: 'session/update',
    params: {
      sessionId: 's',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answer' } },
    },
  });
  protocol.event({ id: 3, result: { stopReason: 'end_turn' } });
  assert.equal(protocol.finish(), 'Answer');
  assert.deepEqual(answers, ['Answer']);
});

test('live duplex ACP subprocess pauses its execution timeout while user considers approval', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-acp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = `const rl=require('node:readline').createInterface({input:process.stdin});
    const send=q=>process.stdout.write(JSON.stringify(q)+'\\n');
    rl.on('line',line=>{const q=JSON.parse(line);if(q.id===1)send({id:1,result:{protocolVersion:1}});
    else if(q.id===2)send({id:2,result:{sessionId:'s',modes:{currentModeId:'deepwork'}}});
    else if(q.id===3)send({id:9,method:'session/request_permission',params:${JSON.stringify(permission)}});
    else if(q.id===9){if(q.result.outcome.optionId!=='no')process.exit(2);
    send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Denied safely'}}}});
    send({id:3,result:{stopReason:'end_turn'}});}});`;
  const answer = await runKiro(
    'context',
    root,
    { provider: 'kiro', execution: 'native', timeoutSeconds: 0.15 },
    null,
    {
      requestPermission: async () => {
        await new Promise((resolve) => setTimeout(resolve, 220));
        return 'no';
      },
      run: (_cmd, _args, options) => runProcess(process.execPath, ['-e', server], options),
    },
  );
  assert.equal(answer, 'Denied safely');
});

async function engineFixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-attention-'));
  const engine = await WorkEngine.open(root, { autoRun: false, ...options });
  t.after(() => {
    engine.close();
    engine.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  engine.saveSettings({
    ...engine.snapshot().settings,
    provider: 'kiro',
    organizationApproved: true,
  });
  return engine;
}

test('task job awaits approval, sync can proceed, decision resumes and persists only audit metadata', async (t) => {
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const engine = await engineFixture(t, {
    runChat: async (_input, _dir, _signal, emit, options) => {
      emit('Partial');
      const pending = options.requestPermission(permission);
      entered();
      assert.equal(await pending, 'no');
      return 'Completed';
    },
    runProvider: async () => ({ text: '', changes: [], facts: [] }),
  });
  const task = engine.addTask({ title: 'Task' });
  const jobId = engine.enqueue('chat', { taskId: task.id, userContext: 'Help' });
  const draining = engine.drain();
  await ready;
  assert.equal(engine.store.get('job', jobId).status, 'awaiting_approval');
  assert.throws(
    () => engine.enqueue('chat', { taskId: task.id, userContext: 'Duplicate' }),
    /current chat/,
  );
  const syncId = await engine.dispatch('sync');
  await tick();
  assert.equal(engine.store.get('job', syncId).status, 'succeeded');
  assert.ok(engine.snapshot().messages.length);
  const request = engine.snapshot().sessions[0].requests[0];
  await engine.dispatch('permission', { jobId, requestId: request.requestId, optionId: 'no' });
  await draining;
  assert.equal(engine.store.get('job', jobId).status, 'succeeded');
  assert.equal(engine.snapshot().sessions.length, 0);
  assert.equal(engine.store.all('event').filter((v) => v.action === 'kiro.permission').length, 1);
  await assert.rejects(
    engine.dispatch('permission', { jobId, requestId: request.requestId, optionId: 'yes' }),
    /no longer active/,
  );
});

test('attention cancellation preserves partial chat and interrupted approvals never survive restart', async (t) => {
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const engine = await engineFixture(t, {
    runChat: async (_input, _dir, _signal, emit, options) => {
      emit('Partial');
      const pending = options.requestPermission(permission);
      entered();
      await pending;
      throw new Error('Stopped');
    },
  });
  const task = engine.addTask({ title: 'Task' });
  const jobId = engine.enqueue('chat', { taskId: task.id, userContext: 'Help' });
  const draining = engine.drain();
  await ready;
  engine.cancel(jobId);
  await draining;
  assert.equal(engine.readTask(task.id).conversation.at(-1).text, 'Partial');
  assert.equal(engine.store.get('job', jobId).status, 'cancelled');
  engine.store.transaction(() => {
    const job = engine.store.get('job', jobId);
    job.status = 'awaiting_approval';
    engine.store.put('job', job);
  });
  const reopened = await WorkEngine.open(engine.store.root, { autoRun: false });
  assert.equal(reopened.store.get('job', jobId).status, 'failed');
  assert.deepEqual(reopened.snapshot().sessions, []);
  reopened.close();
  reopened.store.close();
});

test('Kiro processing failure needs attention and retains pending email for explicit retry', async (t) => {
  const engine = await engineFixture(t, {
    runProvider: async () => {
      throw new Error('Kiro authentication required');
    },
  });
  engine.enqueue('sync');
  await engine.drain();
  assert.ok(engine.snapshot().jobs.some((j) => j.status === 'needs_attention'));
  assert.ok(engine.snapshot().messages.every((m) => !m.processedVersion));
  const failed = engine.snapshot().jobs.find((j) => j.status === 'needs_attention');
  const retried = engine.retry(failed.id);
  assert.equal(engine.store.get('job', retried).status, 'queued');
});

test('approval merges prior tool details and structured output excludes earlier tool-cycle commentary', async () => {
  const sent = [],
    transcript = [];
  let received;
  const protocol = acpProtocol('context', '/tmp/work', {
    structured: true,
    emit: (text) => transcript.push(text),
    requestPermission: async (request) => {
      received = request;
      return 'no';
    },
  });
  protocol.start(
    (line) => sent.push(JSON.parse(line)),
    () => {},
  );
  protocol.event({ id: 1, result: { protocolVersion: 1 } });
  protocol.event({ id: 2, result: { sessionId: 's', modes: { currentModeId: 'deepwork' } } });
  assert.equal(sent.at(-1).params.prompt[0].text, 'context');
  const update = (value) =>
    protocol.event({ method: 'session/update', params: { sessionId: 's', update: value } });
  update({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'I will inspect the source.' },
  });
  update({
    sessionUpdate: 'tool_call',
    toolCallId: 'read',
    title: 'Read configuration',
    rawInput: { path: 'configuration.txt' },
  });
  protocol.event({
    id: 19,
    method: 'session/request_permission',
    params: { sessionId: 's', toolCall: { toolCallId: 'read' }, options: choices },
  });
  await tick();
  assert.equal(received.toolCall.title, 'Read configuration');
  assert.deepEqual(received.toolCall.rawInput, { path: 'configuration.txt' });
  update({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: '{"text":"Summary","changes":[],"facts":[]}' },
  });
  protocol.event({ id: 3, result: { stopReason: 'end_turn' } });
  assert.equal(JSON.parse(protocol.finish()).text, 'Summary');
  assert.ok(transcript.at(-1).startsWith('I will inspect'));
});

test('opaque approval requests cannot offer allow and configured agent mode must be confirmed', async () => {
  let received;
  const protocol = acpProtocol('context', '/tmp/work', {
    requestPermission: async (request) => {
      received = request;
      return 'no';
    },
  });
  protocol.start(
    () => {},
    () => {},
  );
  protocol.event({ id: 1, result: { protocolVersion: 1 } });
  assert.throws(
    () => protocol.event({ id: 2, result: { sessionId: 's', modes: { currentModeId: 'other' } } }),
    /configured agent/,
  );
  protocol.event({ id: 2, result: { sessionId: 's', modes: { currentModeId: 'deepwork' } } });
  protocol.event({
    id: 19,
    method: 'session/request_permission',
    params: { sessionId: 's', toolCall: { toolCallId: 'opaque' }, options: choices },
  });
  await tick();
  assert.deepEqual(
    received.options.map((o) => o.kind),
    ['reject_once'],
  );
});

test('queued sync scans stay serialized when inference resumes before an overlapping scan finishes', async (t) => {
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const scans = [];
  const engine = await engineFixture(t, {
    runChat: async (_input, _dir, _signal, _emit, options) => {
      const pending = options.requestPermission(permission);
      entered();
      await pending;
      return 'Finished';
    },
    outlookRequest: () => new Promise((resolve) => scans.push(resolve)),
  });
  engine.saveSettings({ ...engine.snapshot().settings, mode: 'outlook' });
  const task = engine.addTask({ title: 'Task' });
  const jobId = engine.enqueue('chat', { taskId: task.id, userContext: 'Help' });
  const draining = engine.drain();
  await ready;
  await engine.dispatch('sync');
  await engine.dispatch('sync');
  const request = engine.snapshot().sessions[0].requests[0];
  await engine.dispatch('permission', { jobId, requestId: request.requestId, optionId: 'no' });
  await draining;
  assert.equal(scans.length, 1);
  scans[0]({ messages: [], warnings: [], folders: [] });
  await tick();
  assert.equal(scans.length, 2);
  scans[1]({ messages: [], warnings: [], folders: [] });
  await tick();
  assert.equal(engine.syncBusy, false);
  assert.ok(engine.snapshot().jobs.every((j) => j.status === 'succeeded'));
});

test('structured final response follows message IDs while console preserves earlier messages', () => {
  const transcript = [];
  const protocol = acpProtocol('context', '/tmp/work', {
    structured: true,
    emit: (text) => transcript.push(text),
  });
  protocol.start(
    () => {},
    () => {},
  );
  protocol.event({ id: 1, result: { protocolVersion: 1 } });
  protocol.event({ id: 2, result: { sessionId: 's', modes: { currentModeId: 'deepwork' } } });
  const update = (messageId, text) =>
    protocol.event({
      method: 'session/update',
      params: {
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId,
          content: { type: 'text', text },
        },
      },
    });
  update('commentary', 'Finished checking.');
  update('final', '{"text":"');
  update('final', 'Summary","changes":[],"facts":[]}');
  protocol.event({ id: 3, result: { stopReason: 'end_turn' } });
  assert.equal(JSON.parse(protocol.finish()).text, 'Summary');
  assert.ok(transcript.at(-1).startsWith('Finished checking.'));
});
