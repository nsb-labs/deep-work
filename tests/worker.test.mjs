import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';

test('workspace worker isolates state behind request/response operations', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-worker-'));
  const child = fork(new URL('../service/worker.cjs', import.meta.url), [root], { silent: true });
  t.after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker startup timeout')), 10000);
    child.on('message', (m) => {
      if (m.ready) {
        clearTimeout(timer);
        resolve();
      }
      if (m.fatal) {
        clearTimeout(timer);
        reject(new Error(m.fatal));
      }
    });
    child.on('error', reject);
  });
  let sequence = 0;
  const request = (operation, value) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => reject(new Error('worker request timeout')), 10000);
      const handler = (m) => {
        if (m.id !== id) return;
        clearTimeout(timer);
        child.off('message', handler);
        m.error ? reject(new Error(m.error)) : resolve(m.result);
      };
      child.on('message', handler);
      child.send({ id, operation, value });
    });
  const task = await request('addTask', { title: 'Worker task' });
  const snapshot = await request('snapshot');
  assert.equal(snapshot.tasks[0].id, task.id);
  await assert.rejects(request('runPython', 'untrusted.py'), /Unknown operation/);
  await assert.rejects(
    request('status', { taskId: task.id, revision: 0, status: 'done' }),
    /Task changed/,
  );
});
