import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkEngine } = require('../service/core/engine.cjs');
const { jsonLines, codexProtocol, runChat } = require('../service/providers/chat.cjs');
const { runProcess } = require('../service/providers/process.cjs');
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-chat-'));
  const e = await WorkEngine.open(root, { autoRun: false, ...options });
  t.after(() => {
    e.close();
    e.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return e;
}
test('chat streams before completion, supplies task/source/memory context, persists and isolates task history', async (t) => {
  const events = [],
    inputs = [];
  const e = await fixture(t, {
    onChatEvent: (event) => events.push(event),
    runChat: async (input, _dir, _signal, emit) => {
      inputs.push(input);
      emit('Partial');
      assert.equal(e.readTask(input.task.id).conversation.at(-1).text, 'Partial');
      assert.equal(e.store.get('job', e.activeId).status, 'running');
      return 'Full answer';
    },
  });
  e.enqueue('sync');
  await e.drain();
  const task = e.snapshot().tasks[0],
    beforeFacts = e.snapshot().facts.length;
  const jobId = e.enqueue('chat', { taskId: task.id, userContext: 'What should I do?' });
  assert.throws(
    () => e.enqueue('chat', { taskId: task.id, userContext: 'Duplicate' }),
    /current chat/,
  );
  await e.drain();
  assert.equal(inputs[0].task.id, task.id);
  assert.ok(inputs[0].messages.length);
  assert.ok(inputs[0].memory.length);
  assert.equal(events[0].status, 'running');
  assert.equal(events.at(-1).status, 'completed');
  assert.equal(e.store.get('job', jobId).status, 'succeeded');
  assert.equal(e.snapshot().facts.length, beforeFacts);
  assert.equal(e.requireTask(task.id).revision, task.revision);
  const other = e.addTask({ title: 'Unrelated task' });
  assert.equal(e.readTask(other.id).conversation.length, 0);
  e.enqueue('chat', { taskId: task.id, userContext: 'And then?' });
  await e.drain();
  assert.deepEqual(
    inputs[1].conversation.map((m) => m.text),
    ['What should I do?', 'Full answer'],
  );
  assert.match(
    fs.readFileSync(path.join(e.store.root, 'memory/chats', task.id + '.md'), 'utf8'),
    /Full answer/,
  );
  const reopened = await WorkEngine.open(e.store.root, { autoRun: false });
  assert.equal(reopened.readTask(task.id).conversation.length, 4);
  reopened.close();
  reopened.store.close();
});
test('cancelled chat preserves partial output and excludes incomplete turns from later context', async (t) => {
  let e, entered, release;
  const ready = new Promise((resolve) => (entered = resolve));
  const gate = new Promise((resolve) => (release = resolve));
  e = await fixture(t, {
    runChat: async (_input, _dir, signal, emit) => {
      emit('Partial answer');
      entered();
      await gate;
      if (signal.aborted) throw new Error('Cancelled');
      return 'done';
    },
  });
  const task = e.addTask({ title: 'Manual task' }),
    job = e.enqueue('chat', { taskId: task.id, userContext: 'Question' });
  const draining = e.drain();
  await ready;
  e.cancel(job);
  release();
  await draining;
  const chat = e.readTask(task.id).conversation.at(-1);
  assert.equal(chat.status, 'cancelled');
  assert.equal(chat.text, 'Partial answer');
  assert.match(
    fs.readFileSync(path.join(e.store.root, 'memory/chats', task.id + '.md'), 'utf8'),
    /cancelled[\s\S]*Partial answer/,
  );
  const next = e.enqueue('chat', { taskId: task.id, userContext: 'Next question' });
  assert.deepEqual(e.buildInput(e.store.get('job', next)).conversation, []);
  e.cancel(next);
});
test('failed turns and restart recovery leave explicit failure records', async (t) => {
  const e = await fixture(t, {
    runChat: async (_input, _dir, _signal, emit) => {
      emit('Unfinished');
      throw new Error('Provider unavailable');
    },
  });
  const task = e.addTask({ title: 'Task' });
  e.enqueue('chat', { taskId: task.id, userContext: 'Help' });
  await e.drain();
  assert.equal(e.readTask(task.id).conversation.at(-1).status, 'failed');
  const jobId = e.enqueue('chat', { taskId: task.id, userContext: 'Retry' });
  e.store.transaction(() => {
    const job = e.store.get('job', jobId);
    job.status = 'running';
    e.store.put('job', job);
  });
  const reopened = await WorkEngine.open(e.store.root, { autoRun: false });
  assert.equal(reopened.readTask(task.id).conversation.at(-1).status, 'failed');
  reopened.close();
  reopened.store.close();
});
test('unapproved CLI and empty questions do not create chat records', async (t) => {
  const e = await fixture(t);
  const task = e.addTask({ title: 'Task' });
  assert.throws(() => e.enqueue('chat', { taskId: task.id, userContext: ' ' }), /Invalid chat/);
  e.saveSettings({ ...e.snapshot().settings, provider: 'codex' });
  assert.throws(() => e.enqueue('chat', { taskId: task.id, userContext: 'Help' }), /approved/);
  assert.equal(e.store.all('chat').length, 0);
});
test('JSON line framing preserves split Unicode and trailing event', () => {
  const received = [],
    lines = jsonLines((e) => received.push(e)),
    buffer = Buffer.from('{"text":"日本語"}\n{"done":true}');
  for (const byte of buffer) lines.push(Buffer.from([byte]));
  lines.end();
  assert.deepEqual(received, [{ text: '日本語' }, { done: true }]);
});
test('Codex handshake streams text, reconciles final items, rejects tool requests and incomplete turns', () => {
  const sent = [],
    updates = [];
  let ended = false;
  const p = codexProtocol('context', 'C:\\Work', (text) => updates.push(text));
  p.start(
    (line) => sent.push(JSON.parse(line)),
    () => (ended = true),
  );
  p.event({ id: 1, result: {} });
  p.event({ id: 2, result: { thread: { id: 't1' } } });
  assert.equal(sent[2].params.approvalPolicy, 'never');
  assert.equal(sent[2].params.sandbox, 'read-only');
  p.event({ method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'Hello' } });
  assert.deepEqual(updates, ['Hello']);
  assert.throws(() => p.finish(), /before completing/);
  p.event({ id: 9, method: 'item/commandExecution/requestApproval', params: {} });
  assert.equal(sent.at(-1).error.code, -32601);
  p.event({
    method: 'item/completed',
    params: { item: { type: 'agentMessage', id: 'a', text: 'Hello world' } },
  });
  p.event({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  assert.equal(ended, true);
  assert.equal(p.finish(), 'Hello world');
});
test('chat transport drives a real duplex subprocess and forwards partial output before process exit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-chat-provider-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fakeServer = `const readline=require('node:readline');const rl=readline.createInterface({input:process.stdin});const send=e=>process.stdout.write(JSON.stringify(e)+'\\n');rl.on('line',line=>{const q=JSON.parse(line);if(q.id===1)send({id:1,result:{}});if(q.id===2)send({id:2,result:{thread:{id:'t'}}});if(q.id===3){send({method:'item/agentMessage/delta',params:{itemId:'a',delta:'First'}});setTimeout(()=>{send({method:'item/agentMessage/delta',params:{itemId:'a',delta:' second'}});send({method:'turn/completed',params:{turn:{status:'completed'}}});},30);}});`;
  const updates = [];
  const answer = await runChat(
    {
      settings: {
        provider: 'codex',
        execution: 'native',
        organizationApproved: true,
        timeoutSeconds: 10,
      },
      task: { title: 'Example' },
      messages: [],
      memory: [],
      conversation: [],
      userContext: 'Question',
    },
    root,
    null,
    (text) => updates.push(text),
    {
      run: (_command, args, options) => {
        assert.deepEqual(args, ['app-server']);
        return runProcess(process.execPath, ['-e', fakeServer], options);
      },
    },
  );
  assert.deepEqual(updates, ['First', 'First second']);
  assert.equal(answer, 'First second');
});
