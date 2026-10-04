import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkEngine } = require('../service/core/engine.cjs');
const { demoMessages, demoResult } = require('../service/connectors/demo.cjs');
const { message, validateResult } = require('../service/core/contracts.cjs');
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-test-'));
  const engine = await WorkEngine.open(root, { autoRun: false, ...options });
  t.after(() => {
    engine.close();
    engine.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return engine;
}
async function seed(engine) {
  engine.enqueue('sync');
  await engine.drain();
}

test('demo ingestion produces persistent tasks and Markdown without external integrations', async (t) => {
  const e = await fixture(t);
  await seed(e);
  assert.equal(e.snapshot().tasks.length, 3);
  assert.equal(
    e.snapshot().jobs.every((j) => j.status === 'succeeded'),
    true,
  );
  assert.equal(e.snapshot().tasks.filter((t) => t.status === 'waiting_on').length, 1);
  assert.match(
    fs.readFileSync(path.join(e.store.root, 'memory/briefs/latest.md'), 'utf8'),
    /Waiting on/,
  );
  assert.equal(
    fs.readFileSync(path.join(e.store.root, 'deepwork.sqlite')).subarray(0, 15).toString(),
    'SQLite format 3',
  );
  const reopened = await WorkEngine.open(e.store.root, { autoRun: false });
  assert.equal(reopened.snapshot().tasks.length, 3);
  reopened.close();
  reopened.store.close();
});

test('repeated sync and moved email do not duplicate work; subjects are not identity', async (t) => {
  const e = await fixture(t);
  await seed(e);
  await seed(e);
  assert.equal(e.snapshot().tasks.length, 3);
  assert.equal(e.snapshot().messages.length, 3);
  const original = demoMessages()[0];
  e.ingest([{ ...original, providerId: 'moved', folder: 'Project' }]);
  assert.equal(e.snapshot().messages.length, 3);
  assert.equal(
    e.snapshot().messages.find((m) => m.internetId === original.internetId).providerId,
    'moved',
  );
  e.ingest([{ ...original, internetId: '<other@example.test>', providerId: 'different' }]);
  assert.equal(e.snapshot().messages.length, 4);
});

test('VIP visibility survives provider failures and failed sources remain unprocessed', async (t) => {
  const e = await fixture(t, {
    runProvider: async () => {
      throw new Error('Provider unavailable');
    },
  });
  e.saveSettings({ ...e.store.preferences(), managerEmails: ['MANAGER@example.test'] });
  await seed(e);
  const s = e.snapshot();
  assert.equal(s.tasks.length, 0);
  assert.deepEqual(s.messages.find((m) => m.sender === 'manager@example.test').priorityReasons, [
    'Manager',
  ]);
  assert.equal(
    s.messages.every((m) => m.processedVersion !== m.version),
    true,
  );
  assert.equal(s.jobs.filter((j) => j.status === 'failed').length, 3);
});

test('new email proposes an update; accepting links evidence and records history', async (t) => {
  let current;
  const e = await fixture(t, {
    runProvider: async (input) => {
      if (!current) return demoResult(input);
      return {
        text: '',
        facts: [],
        changes: [
          {
            taskId: current.id,
            title: current.title,
            status: 'done',
            owner: current.owner,
            dueDate: '',
            goal: '',
            evidenceIds: [input.messages.at(-1).id],
            confidence: 0.99,
            reason: 'Explicit completion in the latest message',
          },
        ],
      };
    },
  });
  await seed(e);
  current = e.snapshot().tasks[0];
  const updated = {
    ...demoMessages()[0],
    internetId: '<completion@example.test>',
    providerId: 'completion',
    body: 'This action has been completed.',
    receivedAt: new Date(Date.now() + 1000).toISOString(),
  };
  e.ingest([updated]);
  e.processPending();
  await e.drain();
  assert.equal(e.requireTask(current.id).status, 'open');
  assert.equal(e.snapshot().suggestions.length, 1);
  e.decideSuggestion({ id: e.snapshot().suggestions[0].id, accept: true });
  const task = e.requireTask(current.id);
  assert.equal(task.status, 'done');
  assert.equal(task.evidenceIds.length, 2);
  assert.match(task.history.at(-1).reason, /User accepted/);
});

test('user edits during inference reject stale results without partial mutations', async (t) => {
  const e = await fixture(t);
  await seed(e);
  const task = e.snapshot().tasks[0];
  const jobId = e.enqueue('summarize', { taskId: task.id });
  const job = e.store.get('job', jobId);
  const input = e.buildInput(job);
  e.setStatus({ taskId: task.id, revision: task.revision, status: 'in_progress' });
  const before = e.snapshot().facts.length;
  assert.throws(
    () => e.applyResult(job, input, { text: 'summary', changes: [], facts: [] }),
    /Task changed/,
  );
  assert.equal(e.store.all('artifact').length, 0);
  assert.equal(e.snapshot().facts.length, before);
});

test('drafts preserve task state and never become factual memory', async (t) => {
  const e = await fixture(t);
  await seed(e);
  const task = e.snapshot().tasks[0],
    facts = e.snapshot().facts.length;
  e.enqueue('draft', { taskId: task.id, userContext: 'Ask for clarification.' });
  await e.drain();
  assert.equal(e.requireTask(task.id).revision, task.revision);
  assert.equal(e.snapshot().facts.length, facts);
  const artifact = e.readTask(task.id).artifacts[0];
  assert.match(artifact.text, /Ask for clarification/);
  assert.equal(fs.existsSync(path.join(e.store.root, 'drafts', `${artifact.id}.md`)), true);
  const input = {
    operation: 'draft',
    settings: e.store.preferences(),
    tasks: [task],
    messages: e.readTask(task.id).messages,
  };
  const m = input.messages[0];
  assert.throws(
    () =>
      validateResult(
        {
          text: 'Draft',
          changes: [],
          facts: [
            {
              subject: m.sender,
              relation: 'promised',
              object: 'a reply',
              evidenceId: m.id,
              quote: m.body,
              confidence: 1,
            },
          ],
        },
        input,
      ),
    /unsent draft/,
  );
});

test('invalid citations and invented goals reject the entire AI result', async (t) => {
  const e = await fixture(t);
  e.ingest(demoMessages());
  const j = e.enqueue('classify', { messageId: e.snapshot().messages[0].id });
  const job = e.store.get('job', j),
    input = e.buildInput(job);
  const raw = demoResult(input);
  raw.changes[0].goal = 'Invented goal';
  assert.throws(() => e.applyResult(job, input, raw), /Unconfigured goal/);
  assert.equal(e.snapshot().tasks.length, 0);
  raw.changes[0].goal = '';
  raw.facts[0].quote = 'This sentence is absent';
  assert.throws(() => e.applyResult(job, input, raw), /verbatim/);
  assert.equal(e.snapshot().tasks.length, 0);
});

test('old open tasks and their sources survive lookback and retention', async (t) => {
  const e = await fixture(t);
  e.saveSettings({ ...e.store.preferences(), retentionDays: 15 });
  const old = { ...demoMessages()[0], receivedAt: '2020-01-01T00:00:00Z' };
  e.ingest([old]);
  e.processPending();
  await e.drain();
  e.ingest([]);
  assert.equal(e.snapshot().tasks.length, 1);
  assert.equal(e.snapshot().messages.length, 1);
});

test('manual tasks get summaries without an email source and keep user provenance', async (t) => {
  const e = await fixture(t);
  const task = e.addTask({
    title: 'Follow up from hallway conversation',
    notes: 'Ask the team about the rollout.',
  });
  e.enqueue('summarize', { taskId: task.id });
  await e.drain();
  assert.equal(e.readTask(task.id).artifacts.length, 1);
  assert.equal(e.requireTask(task.id).provenance, 'user');
});

test('cancelled queued work does not mutate tasks; failed jobs retry with current settings', async (t) => {
  const e = await fixture(t);
  e.ingest(demoMessages());
  const job = e.enqueue('classify', { messageId: e.snapshot().messages[0].id });
  e.cancel(job);
  await e.drain();
  assert.equal(e.snapshot().tasks.length, 0);
  assert.equal(e.store.get('job', job).status, 'cancelled');
  const next = e.retry(job);
  await e.drain();
  assert.equal(e.store.get('job', next).status, 'succeeded');
});

test('pending jobs persist and interrupted running work requires explicit retry', async (t) => {
  const e = await fixture(t);
  const tid = e.addTask({ title: 'Persist me' }).id;
  const jid = e.enqueue('summarize', { taskId: tid });
  e.store.transaction(() => {
    const j = e.store.get('job', jid);
    j.status = 'running';
    e.store.put('job', j);
  });
  const reopened = await WorkEngine.open(e.store.root, { autoRun: false });
  assert.equal(reopened.store.get('job', jid).status, 'failed');
  assert.match(reopened.store.get('job', jid).error, /stopped/);
  reopened.close();
  reopened.store.close();
});

test('changing providers preserves work and rejects unsafe executable launchers', async (t) => {
  const e = await fixture(t);
  await seed(e);
  e.saveSettings({ ...e.store.preferences(), provider: 'codex', executable: 'codex.exe' });
  assert.equal(e.snapshot().tasks.length, 3);
  assert.equal(e.snapshot().facts.length, 3);
  assert.throws(
    () => e.saveSettings({ ...e.store.preferences(), executable: 'codex.cmd' }),
    /shell script/,
  );
  assert.throws(() => e.enqueue('summarize', { taskId: e.snapshot().tasks[0].id }), /approved/);
});

test('real mail is not passed to the synthetic provider', async (t) => {
  const e = await fixture(t);
  e.ingest([{ ...demoMessages()[0], account: 'live-profile' }]);
  assert.throws(() => e.processPending(), /real messages/);
});

test('memory correction preserves provenance, and forgetting prevents retrieval', async (t) => {
  const e = await fixture(t);
  await seed(e);
  const f = e.snapshot().facts[0];
  e.updateFact({ id: f.id, subject: f.subject, relation: 'confirmed-topic', object: f.object });
  assert.equal(e.store.get('fact', f.id).provenance, 'user-confirmed');
  e.updateFact({ id: f.id, active: false });
  const task = e.snapshot().tasks[0];
  const job = e.store.get('job', e.enqueue('summarize', { taskId: task.id }));
  assert.equal(
    e.buildInput(job).memory.some((m) => m.id === f.id),
    false,
  );
});

test('failed disk persistence rolls back memory as well as the SQLite transaction', async (t) => {
  const e = await fixture(t);
  const persist = e.store.persist.bind(e.store);
  e.store.persist = () => {
    throw new Error('disk unavailable');
  };
  assert.throws(() => e.addTask({ title: 'Must not survive failed save' }), /disk unavailable/);
  assert.equal(e.snapshot().tasks.length, 0);
  e.store.persist = persist;
  e.addTask({ title: 'Saved successfully' });
  assert.equal(e.snapshot().tasks.length, 1);
});

test('changed source versions supersede extracted memory and preserve historical evidence', async (t) => {
  const e = await fixture(t);
  await seed(e);
  const original = e.snapshot().messages[0];
  e.ingest([
    {
      ...e.readMessage(original.id),
      body: 'The plan has changed.',
      modifiedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(
    e.snapshot().facts.filter((f) => f.active && f.evidenceId === original.id).length,
    0,
  );
  assert.equal(e.store.all('sourceRevision').length, 1);
});

test('retention removes exporter-owned thread copies but preserves user files', async (t) => {
  const e = await fixture(t);
  e.ingest([{ ...demoMessages()[0], receivedAt: '2020-01-01T00:00:00Z' }]);
  e.processPending();
  await e.drain();
  const folder = path.join(e.store.root, 'memory/threads');
  const generated = fs.readdirSync(folder).find((f) => f.endsWith('.md'));
  fs.writeFileSync(path.join(folder, 'my-note.md'), 'User-owned note');
  const task = e.snapshot().tasks[0];
  e.setStatus({ taskId: task.id, revision: task.revision, status: 'done' });
  for (const f of e.snapshot().facts) e.updateFact({ id: f.id, active: false });
  e.ingest([]);
  assert.equal(e.snapshot().messages.length, 0);
  assert.equal(fs.existsSync(path.join(folder, generated)), false);
  assert.equal(fs.readFileSync(path.join(folder, 'my-note.md'), 'utf8'), 'User-owned note');
});

test('pending review evidence remains pinned past source retention', async (t) => {
  const e = await fixture(t, {
    runProvider: async (input) => {
      const r = demoResult(input);
      r.changes[0].confidence = 0.5;
      r.facts = [];
      return r;
    },
  });
  e.ingest([{ ...demoMessages()[0], receivedAt: '2020-01-01T00:00:00Z' }]);
  e.processPending();
  await e.drain();
  e.ingest([]);
  assert.equal(e.snapshot().tasks.length, 0);
  assert.equal(e.snapshot().messages.length, 1);
  assert.equal(e.snapshot().suggestions.length, 1);
  e.decideSuggestion({ id: e.snapshot().suggestions[0].id, accept: true });
  assert.equal(e.snapshot().tasks.length, 1);
});

test('a revised deadline can produce another suggestion after accepting an earlier update', async (t) => {
  const e = await fixture(t);
  await seed(e);
  const task = e.snapshot().tasks[0];
  let due = '2026-10-10';
  e.options.runProvider = async (input) => ({
    text: '',
    facts: [],
    changes: [
      {
        taskId: task.id,
        title: task.title,
        status: 'open',
        owner: 'Me',
        waitingOn: '',
        dueDate: due,
        goal: '',
        evidenceIds: [task.evidenceIds[0]],
        confidence: 0.9,
        reason: 'Updated deadline in source',
      },
    ],
  });
  const original = e.readMessage(task.evidenceIds[0]);
  e.ingest([{ ...original, body: 'Deadline is October 10.', modifiedAt: '2026-10-04T12:00:00Z' }]);
  e.processPending();
  await e.drain();
  e.decideSuggestion({ id: e.snapshot().suggestions[0].id, accept: true });
  assert.equal(e.requireTask(task.id).dueDate, due);
  due = '2026-10-12';
  e.ingest([
    { ...original, body: 'Deadline is now October 12.', modifiedAt: '2026-10-05T12:00:00Z' },
  ]);
  e.processPending();
  await e.drain();
  assert.equal(e.snapshot().suggestions.length, 1);
  assert.equal(e.snapshot().suggestions[0].change.dueDate, due);
});

test('user task edits preserve identity and provenance and invalidate stale revisions', async (t) => {
  const e = await fixture(t);
  const task = e.addTask({ title: 'Original manual task' });
  const edited = e.editTask({
    taskId: task.id,
    revision: task.revision,
    title: 'Updated task',
    notes: 'Meeting details',
    owner: 'Me',
    waitingOn: 'partner@example.test',
    goal: '',
    dueDate: '2026-10-12',
  });
  assert.equal(edited.id, task.id);
  assert.equal(edited.provenance, 'user');
  assert.equal(edited.waitingOn, 'partner@example.test');
  assert.equal(edited.revision, 2);
  assert.throws(
    () => e.setStatus({ taskId: task.id, revision: 1, status: 'done' }),
    /Task changed/,
  );
  assert.throws(
    () => e.editTask({ ...edited, taskId: task.id, dueDate: '2026-99-12' }),
    /Invalid due date/,
  );
});

test('unchanged task proposals do not fill the review queue', async (t) => {
  const e = await fixture(t);
  await seed(e);
  const task = e.snapshot().tasks[0];
  const original = e.readMessage(task.evidenceIds[0]);
  e.options.runProvider = async (input) => ({
    text: '',
    facts: [],
    changes: [
      {
        taskId: task.id,
        title: task.title,
        status: task.status,
        owner: task.owner,
        waitingOn: task.waitingOn,
        goal: task.goal,
        dueDate: task.dueDate,
        evidenceIds: [original.id],
        confidence: 0.95,
        reason: 'No actual change',
      },
    ],
  });
  e.ingest([{ ...original, modifiedAt: '2026-10-04T12:00:00Z' }]);
  e.processPending();
  await e.drain();
  assert.equal(e.snapshot().suggestions.length, 0);
  assert.equal(e.requireTask(task.id).revision, task.revision);
});
