import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkEngine } = require('../service/core/engine.cjs');
const { demoMessages } = require('../service/connectors/demo.cjs');
const { cleanBody, providerPayload, estimateTokens } = require('../service/core/context.cjs');
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-context-'));
  const e = await WorkEngine.open(root, { autoRun: false, ...options });
  t.after(() => {
    e.close();
    e.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return e;
}
const email = (i, body, extra = {}) => ({
  ...demoMessages()[0],
  providerId: 'msg-' + i,
  internetId: `<context-${i}@example.test>`,
  body,
  receivedAt: `2026-10-03T${String(10 + i).padStart(2, '0')}:00:00Z`,
  ...extra,
});
test('local cleanup removes verified Outlook and > quoted suffixes and retains uncertain inline replies', () => {
  const old = {
    body: 'Please review the entire rollout checklist and send the final decision by Friday.',
  };
  const outlook = {
    body:
      'The review is complete.\n\nFrom: Manager\nSent: Yesterday\nTo: Me\nSubject: Checklist\n\n' +
      old.body,
  };
  assert.equal(cleanBody(outlook, [old]).body, 'The review is complete.');
  assert.equal(cleanBody({ body: 'Completed.\n\n> ' + old.body }, [old]).body, 'Completed.');
  const inline = {
    body: 'Reply\nOn yesterday Manager wrote:\n> ' + old.body + '\nMy new deadline is Monday.',
  };
  assert.equal(cleanBody(inline, [old]).body, inline.body);
  assert.equal(cleanBody(outlook, []).body, outlook.body);
});
test('only standard short contact signatures are removed; action-bearing footers and quote-only sources survive', () => {
  assert.equal(
    cleanBody({ body: 'Please approve.\n-- \nAlex\nalex@example.test' }, []).body,
    'Please approve.',
  );
  const footer = { body: 'Hello\n-- \nPlease send the revised plan by Friday.\nalex@example.test' };
  assert.equal(cleanBody(footer, []).body, footer.body);
  const quote = {
    body: '> This long sentence contains the current plan and the proposed Friday deadline.',
  };
  assert.equal(cleanBody(quote, [{ body: quote.body.slice(2) }]).body, quote.body);
});
test('one thread request includes every new email in chronological order using SentOn for outgoing mail', async (t) => {
  const calls = [];
  const e = await fixture(t, {
    runProvider: async (input) => {
      calls.push(input);
      return { text: '', changes: [], facts: [] };
    },
  });
  e.ingest([
    email(1, 'An earlier action.', {
      receivedAt: '2026-10-03T15:00:00Z',
      isSent: true,
      sentAt: '2026-10-03T09:00:00Z',
    }),
    email(2, 'Latest reply.'),
  ]);
  assert.equal(e.processPending().length, 1);
  assert.equal(e.processPending().length, 0);
  await e.drain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].body, 'An earlier action.');
  assert.equal(calls[0].processedMessageIds.length, 2);
  assert.ok(e.snapshot().messages.every((m) => m.version === m.processedVersion));
  assert.equal(e.processPending().length, 0);
});
test('large threads continue in bounded batches without marking unseen messages processed', async (t) => {
  const calls = [];
  let e;
  e = await fixture(t, {
    runProvider: async (input) => {
      assert.ok(2000 + estimateTokens(providerPayload(input)) <= 5000);
      calls.push(input.processedMessageIds);
      assert.ok(
        input.processedMessageIds.every(
          (id) => e.readMessage(id).processedVersion !== e.readMessage(id).version,
        ),
      );
      return { text: '', changes: [], facts: [] };
    },
  });
  e.saveSettings({ ...e.store.preferences(), contextTokenBudget: 5000 });
  e.ingest([
    email(1, 'Action A. ' + 'a'.repeat(3000)),
    email(2, 'Action B. ' + 'b'.repeat(3000)),
    email(3, 'Action C. ' + 'c'.repeat(3000)),
  ]);
  e.processPending();
  await e.drain();
  assert.ok(calls.length > 1);
  assert.equal(new Set(calls.flat()).size, 3);
  assert.ok(e.snapshot().messages.every((m) => m.processedVersion === m.version));
  assert.ok(
    e
      .snapshot()
      .jobs.every((j) => j.status === 'succeeded' && j.contextStats.estimatedTokens <= 5000),
  );
});
test('oversized individual mail fails visibly and remains pending with the full original', async (t) => {
  let calls = 0;
  const e = await fixture(t, {
    runProvider: async () => {
      calls++;
      return { text: '', changes: [], facts: [] };
    },
  });
  e.saveSettings({ ...e.store.preferences(), contextTokenBudget: 4000 });
  const original = email(1, 'z'.repeat(12000));
  e.ingest([original]);
  e.processPending();
  await e.drain();
  assert.equal(calls, 0);
  assert.equal(e.snapshot().jobs[0].status, 'failed');
  assert.match(e.snapshot().jobs[0].error, /remains unprocessed/);
  const saved = e.readMessage(e.snapshot().messages[0].id);
  assert.equal(saved.body, original.body);
  assert.notEqual(saved.processedVersion, saved.version);
});
test('metadata-only changes preserve processed versions and legacy evidence without inference', async (t) => {
  const e = await fixture(t);
  e.ingest([email(1, 'Original action.')]);
  e.processPending();
  await e.drain();
  const before = e.readMessage(e.snapshot().messages[0].id),
    facts = e.snapshot().facts.length;
  e.ingest([
    { ...before, modifiedAt: '2026-10-04T12:00:00Z', folder: 'Archive', providerId: 'moved' },
  ]);
  assert.equal(e.processPending().length, 0);
  assert.equal(e.snapshot().facts.length, facts);
  assert.equal(e.readMessage(before.id).version, before.version);
  e.store.transaction(() => {
    const old = e.readMessage(before.id);
    old.version = 'legacy-version';
    old.processedVersion = 'legacy-version';
    delete old.contentHash;
    e.store.put('message', old);
  });
  e.ingest([{ ...before, modifiedAt: '2026-10-05T12:00:00Z' }]);
  assert.equal(e.processPending().length, 0);
  assert.equal(e.readMessage(before.id).version, 'legacy-version');
});
test('provider projection excludes unrelated tasks, task history, Outlook IDs, and CLI configuration', async (t) => {
  const e = await fixture(t);
  for (let i = 0; i < 40; i++)
    e.addTask({ title: 'Unrelated gardening ' + i, notes: 'private notes that are irrelevant' });
  e.ingest([email(1, 'Please prepare the launch readiness report.')]);
  const job = e.store.get('job', e.processPending()[0]);
  const payload = providerPayload(e.buildInput(job)),
    serialized = JSON.stringify(payload);
  assert.equal(payload.tasks.length, 0);
  assert.ok(!serialized.includes('Unrelated gardening'));
  for (const field of [
    'providerId',
    'storeId',
    'modifiedAt',
    'organizationApproved',
    'executable',
    'history',
  ])
    assert.ok(!serialized.includes('"' + field + '"'));
});
test('a changed source rejects the entire thread result without marking any source processed', async (t) => {
  const e = await fixture(t);
  e.ingest([email(1, 'First action.'), email(2, 'Second action.')]);
  const job = e.store.get('job', e.processPending()[0]),
    input = e.buildInput(job);
  e.ingest([email(2, 'Revised action.')]);
  assert.throws(
    () => e.applyResult(job, input, { text: '', changes: [], facts: [] }),
    /Email changed/,
  );
  assert.ok(e.snapshot().messages.every((m) => m.processedVersion !== m.version));
});

test('task chat can explicitly include an older original email and rejects unrelated source IDs', async (t) => {
  const e = await fixture(t);
  e.ingest([email(1, 'The initial deadline is October 10.'), email(2, 'Latest status update.')]);
  const records = e.snapshot().messages;
  const task = e.addTask({ title: 'Launch readiness' });
  e.store.transaction(() => {
    const saved = e.requireTask(task.id);
    saved.evidenceIds = [records[0].id];
    e.store.put('task', saved);
  });
  const id = e.enqueue('chat', {
    taskId: task.id,
    userContext: 'Explain the original deadline.',
    sourceId: records[0].id,
  });
  const input = e.buildInput(e.store.get('job', id));
  assert.equal(
    input.messages.find((m) => m.id === records[0].id).body,
    e.readMessage(records[0].id).body,
  );
  e.cancel(id);
  const invalid = e.enqueue('chat', {
    taskId: task.id,
    userContext: 'Read another account',
    sourceId: 'not-linked',
  });
  assert.throws(() => e.buildInput(e.store.get('job', invalid)), /not linked/);
  e.cancel(invalid);
});

test('repeated quoted bodies reduce the outgoing projection while preserving every original source', async (t) => {
  const e = await fixture(t);
  const original =
    'Please review the launch report carefully. ' + 'Detailed source text. '.repeat(100);
  e.ingest([
    email(1, original),
    email(
      2,
      'The deadline is now Monday.\n\nFrom: Manager\nSent: Yesterday\nTo: Me\nSubject: Launch\n\n' +
        original,
    ),
  ]);
  const job = e.store.get('job', e.processPending()[0]);
  const input = e.buildInput(job);
  assert.equal(input.messages[1].body, 'The deadline is now Monday.');
  assert.ok(input.messages[1].removedCharacters > original.length);
  assert.equal(input.processedMessageIds.length, 2);
  assert.ok(JSON.stringify(input.messages).length < JSON.stringify(e.store.all('message')).length);
  assert.ok(e.readMessage(input.messages[1].id).body.includes(original.trimEnd()));
});
