// Runtime contracts are shared by IPC, email connectors, and AI output validation.
const { createHash, randomUUID } = require('node:crypto');
const STATUSES = ['open', 'in_progress', 'waiting_on', 'done', 'dismissed'];
const now = () => new Date().toISOString();
const id = () => randomUUID();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value, label, max = 2000, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw new Error(`Invalid ${label}`);
  return value.trim();
}
function list(value, label, max = 100) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
  return value;
}
function dateOnly(value) {
  const result = text(value, 'due date', 30, true);
  if (
    result &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(result) ||
      !Number.isFinite(Date.parse(result)) ||
      new Date(result).toISOString().slice(0, 10) !== result)
  )
    throw new Error('Invalid due date');
  return result;
}
function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`Invalid ${label}`);
  return value;
}
const DEFAULTS = {
  theme: 'dark',
  mode: 'demo',
  lookbackDays: 1,
  vipEmails: [],
  managerEmails: [],
  goals: [],
  folders: [],
  provider: 'demo',
  executable: '',
  execution: 'native',
  wslDistribution: '',
  agent: '',
  organizationApproved: false,
  timeoutSeconds: 180,
  maxMessages: 500,
  retentionDays: 90,
  contextTokenBudget: 8000,
};
function settings(value) {
  object(value, 'settings');
  const p = { ...DEFAULTS, ...value };
  p.theme = oneOf(p.theme, ['dark', 'light'], 'theme');
  p.mode = oneOf(p.mode, ['demo', 'outlook'], 'mail mode');
  p.provider = oneOf(p.provider, ['demo', 'kiro', 'codex'], 'AI provider');
  p.execution = oneOf(p.execution, ['native', 'wsl'], 'execution mode');
  for (const [key, min, max] of [
    ['lookbackDays', 1, 15],
    ['timeoutSeconds', 10, 600],
    ['maxMessages', 1, 5000],
    ['retentionDays', 15, 3650],
    ['contextTokenBudget', 4000, 64000],
  ]) {
    if (!Number.isInteger(p[key]) || p[key] < min || p[key] > max)
      throw new Error(`${key} must be ${min}–${max}`);
  }
  for (const key of ['vipEmails', 'managerEmails'])
    p[key] = list(p[key], key).map((v) => text(v, key, 254).toLowerCase());
  p.goals = list(p.goals, 'goals', 50).map((v) => text(v, 'goal', 300));
  p.folders = list(p.folders, 'folders', 50).map((v) => text(v, 'folder', 1000));
  for (const key of ['executable', 'wslDistribution', 'agent'])
    p[key] = text(p[key], key, 1000, true);
  if (p.executable && /[\r\n\0]/.test(p.executable)) throw new Error('Invalid executable');
  if (p.execution === 'native' && /\.(cmd|bat|ps1)$/i.test(p.executable))
    throw new Error(
      'Use an executable, not a shell script. For npm Codex, select its native codex.exe or use WSL.',
    );
  if (typeof p.organizationApproved !== 'boolean') throw new Error('Invalid organization approval');
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, p[key]]));
}
function message(value) {
  object(value, 'message');
  const m = {};
  for (const [key, max, optional] of [
    ['account', 1000, false],
    ['providerId', 2000, false],
    ['storeId', 2000, true],
    ['internetId', 2000, true],
    ['threadId', 2000, false],
    ['folder', 1000, false],
    ['subject', 2000, true],
    ['sender', 1000, false],
    ['body', 100000, true],
    ['receivedAt', 100, false],
    ['modifiedAt', 100, false],
  ]) {
    m[key] = text(value[key] ?? (optional ? '' : undefined), key, max, optional);
  }
  for (const key of ['receivedAt', 'modifiedAt'])
    if (!Number.isFinite(Date.parse(m[key]))) throw new Error(`Invalid ${key}`);
  m.recipients = list(value.recipients ?? [], 'recipients', 500).map((v) =>
    text(v, 'recipient', 1000),
  );
  m.isSent = value.isSent === true;
  m.sentAt = text(value.sentAt ?? '', 'sent date', 100, true);
  if (m.sentAt && !Number.isFinite(Date.parse(m.sentAt))) throw new Error('Invalid sent date');
  m.id = hash([m.account, m.internetId || m.providerId]);
  m.contentHash = hash([
    m.subject,
    m.body,
    m.sender,
    [...m.recipients].sort(),
    m.threadId,
    m.isSent,
  ]);
  m.version = m.contentHash;
  return m;
}
const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'changes', 'facts'],
  properties: {
    text: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'taskId',
          'title',
          'status',
          'owner',
          'waitingOn',
          'dueDate',
          'goal',
          'evidenceIds',
          'confidence',
          'reason',
        ],
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: STATUSES },
          owner: { type: 'string' },
          waitingOn: { type: 'string' },
          dueDate: { type: 'string' },
          goal: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'relation', 'object', 'evidenceId', 'quote', 'confidence'],
        properties: {
          subject: { type: 'string' },
          relation: { type: 'string' },
          object: { type: 'string' },
          evidenceId: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
};
function validateResult(value, input) {
  object(value, 'AI result');
  const confidence = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
      throw new Error('Invalid confidence');
    return v;
  };
  const sources = new Map(input.messages.map((m) => [m.id, m]));
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const out = { text: text(value.text, 'result text', 50000, true), changes: [], facts: [] };
  const seen = new Set();
  for (const raw of list(value.changes, 'changes', 30)) {
    object(raw, 'change');
    const c = {};
    for (const [key, max, optional] of [
      ['taskId', 100, true],
      ['title', 500, false],
      ['owner', 500, true],
      ['waitingOn', 500, true],
      ['dueDate', 30, true],
      ['goal', 300, true],
      ['reason', 2000, false],
    ])
      c[key] = text(raw[key] ?? (optional ? '' : undefined), key, max, optional);
    c.status = oneOf(raw.status, STATUSES, 'task status');
    c.confidence = confidence(raw.confidence);
    c.evidenceIds = [
      ...new Set(list(raw.evidenceIds, 'evidence', 30).map((v) => text(v, 'evidence ID', 100))),
    ];
    if (!c.evidenceIds.length || c.evidenceIds.some((v) => !sources.has(v)))
      throw new Error('Change cites missing evidence');
    if (c.taskId && (!tasks.has(c.taskId) || seen.has(c.taskId)))
      throw new Error('Unknown or repeated task ID');
    if (c.taskId) seen.add(c.taskId);
    if (c.goal && !input.settings.goals.includes(c.goal)) throw new Error('Unconfigured goal');
    c.dueDate = dateOnly(c.dueDate);
    // Only classification can change work. Summaries and drafts are derived artifacts.
    if (input.operation !== 'classify')
      throw new Error('Summaries and drafts cannot change task state');
    out.changes.push(c);
  }
  for (const raw of list(value.facts, 'facts', 50)) {
    object(raw, 'fact');
    const f = {};
    for (const [key, max] of [
      ['subject', 300],
      ['relation', 100],
      ['object', 1000],
      ['evidenceId', 100],
      ['quote', 2000],
    ])
      f[key] = text(raw[key], key, max);
    f.confidence = confidence(raw.confidence);
    const source = sources.get(f.evidenceId);
    if (!source || !source.body.includes(f.quote))
      throw new Error('Fact must cite a verbatim source excerpt');
    if (input.operation === 'draft') throw new Error('An unsent draft cannot write factual memory');
    out.facts.push(f);
  }
  if (input.operation !== 'classify' && !out.text) throw new Error('Provider returned no content');
  return out;
}
module.exports = {
  STATUSES,
  DEFAULTS,
  now,
  id,
  hash,
  text,
  list,
  object,
  oneOf,
  dateOnly,
  settings,
  message,
  resultSchema,
  validateResult,
};
