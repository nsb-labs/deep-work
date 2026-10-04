const path = require('node:path');
const fs = require('node:fs');
const { atomicWrite } = require('./store.cjs');
const { now, hash } = require('./contracts.cjs');
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]/g, ' ')
    .replace(/</g, '&lt;');
function sourceText(m) {
  return `## ${m.subject || '(No subject)'}\n\nSource ID: ${m.id}\nFrom: ${m.sender}\nDate: ${m.receivedAt}\nFolder: ${m.folder}\n\n${m.body}\n`;
}
function exportMarkdown(store) {
  const root = store.root,
    tasks = store.all('task'),
    messages = store.all('message'),
    facts = store.all('fact').filter((f) => f.active);
  const generated = [];
  const write = (file, content) => {
    generated.push(file);
    const target = path.join(root, file);
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content)
      atomicWrite(target, content);
  };
  const updated = now();
  const table = (items) =>
    '| ID | Subject | Status | Owner | Waiting on | Goal | Due |\n|---|---|---|---|---|---|---|\n' +
    items
      .map(
        (t) =>
          `| ${cell(t.id)} | ${cell(t.title)} | ${t.status} | ${cell(t.owner)} | ${cell(t.waitingOn)} | ${cell(t.goal)} | ${cell(t.dueDate)} |`,
      )
      .join('\n') +
    '\n';
  const active = tasks.filter((t) => !['done', 'dismissed'].includes(t.status));
  write(
    'memory/briefs/latest.md',
    `# DeepWork brief\n\nUpdated: ${updated}\n\n## Action required\n\n${table(active.filter((t) => t.status !== 'waiting_on'))}\n## Waiting on\n\n${table(active.filter((t) => t.status === 'waiting_on'))}\n## Completed\n\n${table(tasks.filter((t) => t.status === 'done'))}\n## Priority email\n\n` +
      messages
        .filter((m) => m.priorityReasons.length)
        .map(
          (m) =>
            `- ${cell(m.subject)} — ${cell(m.sender)} (${m.priorityReasons.join(', ')}); source ${m.id}; ${m.processedVersion === m.version ? 'processed' : 'unprocessed'}`,
        )
        .join('\n'),
  );
  for (const task of tasks) {
    write(
      `memory/tasks/${task.id}.md`,
      `---\nid: ${task.id}\nrevision: ${task.revision}\nstatus: ${task.status}\n---\n\n# ${cell(task.title)}\n\nOwner: ${cell(task.owner)}\nWaiting on: ${cell(task.waitingOn)}\nGoal: ${cell(task.goal)}\nDue: ${cell(task.dueDate)}\nProvenance: ${task.provenance}\n\n${task.notes || ''}\n\n## Sources\n\n` +
        task.evidenceIds
          .map((mid) => messages.find((m) => m.id === mid))
          .filter(Boolean)
          .map(sourceText)
          .join('\n') +
        '\n## Status history\n\n' +
        task.history.map((h) => `- ${h.at}: ${h.status} (${cell(h.reason)})`).join('\n'),
    );
  }
  for (const task of tasks) {
    const conversation = store.all('chat').filter((c) => c.taskId === task.id);
    if (conversation.length)
      write(
        `memory/chats/${task.id}.md`,
        `# Task conversation: ${cell(task.title)}\n\nGenerated answers are conversation, not factual memory.\n\n` +
          conversation
            .map(
              (c) =>
                `## ${c.role} · ${c.status} · ${c.createdAt}\n\n${c.text}\n${c.error ? '\nError: ' + c.error : ''}\n`,
            )
            .join('\n'),
      );
  }
  const threads = new Map();
  for (const m of messages) {
    const key = hash([m.account, m.threadId]);
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(m);
  }
  for (const [key, items] of threads)
    write(
      `memory/threads/${key}.md`,
      '# Email thread\n\n' +
        items
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
          .map(sourceText)
          .join('\n'),
    );
  const factText = (f) =>
    `- ${cell(f.subject)} → ${cell(f.relation)} → ${cell(f.object)}\n  - ${f.provenance}; confidence ${f.confidence}; source ${f.evidenceId || 'user'}\n  - Evidence: ${cell(f.quote || '')}`;
  write(
    'memory/graph/index.md',
    '# Work memory\n\nExtracted facts need review; a source excerpt does not prove the inferred relation. Drafts do not create facts.\n\n' +
      facts.map(factText).join('\n'),
  );
  const entities = [...new Set(facts.flatMap((f) => [f.subject, f.object]))];
  for (const entity of entities)
    write(
      `memory/graph/nodes/${hash(entity)}.md`,
      `# ${cell(entity)}\n\n` +
        facts
          .filter((f) => f.subject === entity || f.object === entity)
          .map(factText)
          .join('\n'),
    );
  write('preferences.json', JSON.stringify(store.preferences(), null, 2) + '\n');
  const cutoff = Date.now() - 7 * 86400000;
  const doneEvents = store
    .all('event')
    .filter((e) => e.action === 'task-status' && e.status === 'done' && Date.parse(e.at) >= cutoff);
  const completed = [...new Set(doneEvents.map((e) => e.recordId))]
    .map((tid) => tasks.find((t) => t.id === tid))
    .filter(Boolean);
  write(
    'memory/graph/weekly-achievements/current.md',
    `# Work completed in the last seven days\n\nGenerated: ${updated}\n\n` +
      completed.map((t) => `- ${cell(t.title)}${t.goal ? ` — ${cell(t.goal)}` : ''}`).join('\n'),
  );
  // Remove only files previously emitted by this exporter; user files are never glob-deleted.
  const manifestFile = path.join(root, 'projection-manifest.json');
  let previous = [];
  if (fs.existsSync(manifestFile)) previous = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const ownedPath =
    /^(?:memory\/(?:tasks|threads|graph\/nodes)\/[a-f0-9-]+\.md|memory\/briefs\/latest\.md|memory\/graph\/index\.md|memory\/graph\/weekly-achievements\/current\.md|preferences\.json)$/;
  for (const file of previous)
    if (typeof file === 'string' && ownedPath.test(file) && !generated.includes(file))
      fs.rmSync(path.join(root, file), { force: true });
  atomicWrite(manifestFile, JSON.stringify(generated, null, 2));
  // Rebuildable projections; the database remains authoritative if an export fails.
  return updated;
}
module.exports = { exportMarkdown, sourceText, cell };
