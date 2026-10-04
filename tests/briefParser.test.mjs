import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// The parser is dependency-free. Transpile it in memory to exercise the same
// source as the application without adding a second test/build dependency.
const source = await readFile(new URL('../src/lib/briefParser.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { parseBrief } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('the public example populates every generic dashboard section', async () => {
  const example = await readFile(new URL('../examples/brief.md', import.meta.url), 'utf8');
  const brief = parseBrief(example);
  for (const key of [
    'priorityItems',
    'importantContacts',
    'actionRequired',
    'projects',
    'reviews',
    'pending',
    'waitingOn',
    'fyi',
  ]) {
    assert.equal(brief[key].length, 1, key);
  }
  assert.equal(brief.priorityItems[0].subject, "Confirm tomorrow's appointment");
  assert.equal(brief.projects[0].project, 'Community event');
  assert.equal(brief.projects[0].owner, 'Me');
  assert.equal(brief.reviews[0].item, 'Draft agenda');
  assert.equal(brief.reviews[0].context, 'Community event');
  assert.equal(brief.meta.updated, '2026-10-03T12:00:00Z');
});

test('a blank brief does not invent contacts, projects, or work items', () => {
  const brief = parseBrief('');
  for (const key of [
    'priorityItems',
    'importantContacts',
    'actionRequired',
    'projects',
    'reviews',
    'pending',
    'waitingOn',
    'fyi',
  ]) {
    assert.deepEqual(brief[key], []);
  }
  assert.equal(brief.weeklyReport, '');
});

test('an arbitrary person heading is not automatically treated as a priority contact', () => {
  const brief = parseBrief(
    '## Example Person\n| # | Subject | Status | Remarks |\n|---|---|---|---|\n| 1 | Hello | NEW | |',
  );
  assert.deepEqual(brief.priorityItems, []);
  assert.deepEqual(brief.importantContacts, []);
});
