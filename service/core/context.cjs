// Deterministic preparation: originals remain in SQLite; only this projection reaches a provider.
const { retrieveMemory } = require('./memory.cjs');
const timestamp = (m) => (m.isSent && m.sentAt ? m.sentAt : m.receivedAt);
const chronological = (a, b) =>
  Date.parse(timestamp(a)) - Date.parse(timestamp(b)) || a.id.localeCompare(b.id);
const normalizeQuote = (body) =>
  body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*>\s?/, '').trim())
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
function cleanBody(message, earlier) {
  let body = message.body;
  const originalLength = body.length;
  const known = earlier.map((m) => (typeof m === 'string' ? m : normalizeQuote(m.body)));
  const matches = (tail) => {
    const normalized = normalizeQuote(tail);
    return normalized.length >= 40 && known.some((text) => text.includes(normalized));
  };
  // Remove a quoted suffix only when its text is present in a known earlier email.
  const boundary = /(?:^|\n)(?:On [^\n]+ wrote:|[- ]*Original Message[- ]*|From:[^\n]*)\r?\n/g;
  for (const match of body.matchAll(boundary)) {
    const tail = body.slice(match.index + match[0].length);
    let quoted = tail;
    if (/From:|Original Message/.test(match[0])) {
      const headers = /^(?:From|Sent|Date|To|Cc|Subject):[^\n]*(?:\r?\n|$)/;
      let rest = tail;
      let count = /From:/.test(match[0]) ? 1 : 0;
      while (headers.test(rest)) {
        rest = rest.replace(headers, '');
        count++;
      }
      if (count < 3) continue;
      quoted = rest.replace(/^\s*\r?\n/, '');
    }
    if (matches(quoted)) {
      body = body.slice(0, match.index).trimEnd();
      break;
    }
  }
  // A fully quoted suffix can be removed; inline replies intermixed with quotes stay intact.
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tail = lines.slice(i);
    if (
      /^\s*>/.test(lines[i]) &&
      tail.every((line) => !line.trim() || /^\s*>/.test(line)) &&
      matches(tail.join('\n'))
    ) {
      body = lines.slice(0, i).join('\n').trimEnd();
      break;
    }
  }
  // Only a standard signature separator followed by a short contact footer is removed.
  const signature = /\n-- \r?\n([\s\S]*)$/.exec(body);
  if (
    signature &&
    signature[1].split(/\r?\n/).length <= 8 &&
    signature[1]
      .trim()
      .split(/\r?\n/)
      .every(
        (line, index) =>
          !line.trim() ||
          /^(?:(?:Email|E-mail|Phone|Tel|Mobile|Web):\s*)?(?:[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+|\+?\d[\d ()-]{7,})$/i.test(
            line.trim(),
          ) ||
          (index === 0 && /^[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’-]+){0,2}$/u.test(line.trim())),
      ) &&
    /@|https?:\/\/|\+?\d[\d ()-]{7,}/.test(signature[1]) &&
    !/\b(please|deadline|due|will|must|action|waiting|send|review|approve|complete|by (?:monday|tuesday|wednesday|thursday|friday))\b/i.test(
      signature[1],
    )
  )
    body = body.slice(0, signature.index).trimEnd();
  // Never turn a source consisting entirely of quotes/signature into an empty message.
  if (!body.trim()) body = message.body;
  return { body, removedCharacters: originalLength - body.length };
}
const compactTask = (t, selected = false) => ({
  id: t.id,
  revision: t.revision,
  title: t.title,
  status: t.status,
  owner: t.owner,
  waitingOn: t.waitingOn,
  goal: t.goal,
  dueDate: t.dueDate,
  evidenceIds: t.evidenceIds,
  ...(selected ? { notes: t.notes } : {}),
});
function compactMessage(m, earlier) {
  const cleaned = cleanBody(m, earlier);
  return {
    id: m.id,
    version: m.version,
    subject: m.subject,
    sender: m.sender,
    recipients: m.recipients.slice(0, 20),
    ...(m.recipients.length > 20 ? { additionalRecipientCount: m.recipients.length - 20 } : {}),
    receivedAt: m.receivedAt,
    sentAt: m.sentAt || '',
    isSent: m.isSent,
    body: cleaned.body,
    removedCharacters: cleaned.removedCharacters,
  };
}
function providerPayload(input) {
  return {
    operation: input.operation,
    goals: input.settings.goals,
    task: input.task,
    tasks: input.task ? [] : input.tasks,
    messages: input.messages,
    memory: input.memory,
    newMessageIds: input.processedMessageIds || [],
    conversation: input.conversation,
    userContext: input.userContext,
    context: input.context,
  };
}
// Provider-independent estimate, not a model tokenizer. Reserve room for protocol/schema overhead.
const estimateTokens = (value) => Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 2);
function prepareContext(
  store,
  { operation, settings, task, messages, requiredIds, conversation, userContext, sourceId },
) {
  const budget = settings.contextTokenBudget || 8000;
  const sorted = [...messages].sort(chronological);
  const knownBodies = sorted.map((m) => normalizeQuote(m.body));
  const byId = new Map();
  const source = (id) => {
    if (!byId.has(id)) {
      const index = sorted.findIndex((m) => m.id === id);
      byId.set(id, compactMessage(sorted[index], knownBodies.slice(0, index)));
    }
    return byId.get(id);
  };
  const sourceIds = new Set(sorted.map((m) => m.id));
  const terms = new Set(
    sorted
      .flatMap((m) => [m.subject, m.sender])
      .join(' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}@._-]+/u)
      .filter((s) => s.length > 3),
  );
  const ranked = store
    .all('task')
    .map((t) => {
      const linked = t.evidenceIds.some((id) => sourceIds.has(id));
      const text = `${t.title} ${t.goal} ${t.owner} ${t.waitingOn}`.toLowerCase();
      const matches = [...terms].filter((term) => text.includes(term)).length;
      return { task: t, linked, score: linked ? 1000 : matches };
    })
    .filter((r) => r.linked || (r.score >= 2 && !['done', 'dismissed'].includes(r.task.status)))
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
  const linked = task
    ? [compactTask(task, true)]
    : ranked.filter((r) => r.linked).map((r) => compactTask(r.task));
  const input = {
    operation,
    settings,
    task: task ? compactTask(task, true) : null,
    tasks: linked,
    messages: [],
    memory: [],
    conversation: [],
    userContext,
    processedMessageIds: [],
    context: {
      budget,
      estimateMethod: 'UTF-8 bytes / 2 + protocol reserve',
      omittedOlderMessages: 0,
      omittedConversationMessages: 0,
    },
  };
  const cost = () => 2000 + estimateTokens(providerPayload(input));
  if (cost() > budget)
    throw new Error(
      'Task context exceeds the estimated token budget. Increase Context token budget in Settings.',
    );
  const required = sorted.filter((m) => requiredIds.includes(m.id));
  if (operation === 'classify' && !required.length) return null;
  for (const m of required.slice(0, 20)) {
    input.messages.push(source(m.id));
    input.processedMessageIds.push(m.id);
    if (cost() > budget) {
      input.messages.pop();
      input.processedMessageIds.pop();
      if (!input.messages.length)
        throw new Error(
          'An unprocessed email exceeds the estimated token budget even after safe cleanup. Increase Context token budget; the email remains unprocessed.',
        );
      break; // Continue with another page after this batch succeeds.
    }
  }
  // Task conversations require the latest source; older emails are optional context.
  if (operation !== 'classify' && sorted.length) {
    input.messages.push(source(sorted.at(-1).id));
    if (cost() > budget)
      throw new Error(
        'The latest email exceeds the estimated token budget. Increase Context token budget.',
      );
  }
  if (operation === 'chat' && sourceId) {
    const original = sorted.find((m) => m.id === sourceId);
    if (!original) throw new Error('Selected email is not linked to this task.');
    const selected = { ...source(sourceId), body: original.body, removedCharacters: 0 };
    const index = input.messages.findIndex((m) => m.id === sourceId);
    if (index >= 0) input.messages[index] = selected;
    else input.messages.push(selected);
    if (cost() > budget)
      throw new Error(
        'Selected email exceeds the estimated token budget. Increase Context token budget.',
      );
  }
  const add = (list, value) => {
    list.push(value);
    if (cost() > budget) {
      list.pop();
      return false;
    }
    return true;
  };
  if (!task)
    for (const candidate of ranked.filter((r) => !r.linked).slice(0, 5))
      add(input.tasks, compactTask(candidate.task));
  for (const fact of retrieveMemory(
    store,
    sorted,
    task ? [task] : ranked.filter((r) => r.linked).map((r) => r.task),
    5,
  ))
    add(input.memory, {
      id: fact.id,
      subject: fact.subject,
      relation: fact.relation,
      object: fact.object,
      evidenceId: fact.evidenceId,
      quote: fact.quote,
      provenance: fact.provenance,
      confidence: fact.confidence,
    });
  // Keep dialogue in user/assistant pairs so trimming never leaves an orphan answer.
  for (let end = conversation.length; end > 0; end -= 2) {
    const pair = conversation.slice(Math.max(0, end - 2), end);
    input.conversation.unshift(...pair);
    if (cost() > budget) {
      input.conversation.splice(0, pair.length);
      break;
    }
  }
  input.context.omittedConversationMessages = conversation.length - input.conversation.length;
  const older = sorted
    .filter((m) => !input.messages.some((s) => s.id === m.id) && !requiredIds.includes(m.id))
    .reverse()
    .slice(0, 2);
  for (const m of older) add(input.messages, source(m.id));
  input.messages.sort(chronological);
  input.context.omittedOlderMessages = sorted.filter(
    (m) => !input.messages.some((s) => s.id === m.id) && !requiredIds.includes(m.id),
  ).length;
  // Counts may add a few tokens. Drop optional fields until the estimate fits.
  while (cost() > budget && input.memory.length) input.memory.pop();
  while (cost() > budget && input.conversation.length) {
    const removed = input.conversation.splice(0, Math.min(2, input.conversation.length));
    input.context.omittedConversationMessages += removed.length;
  }
  if (cost() > budget)
    throw new Error('Context exceeds estimated token budget. Increase it in Settings.');
  return input;
}
module.exports = {
  cleanBody,
  chronological,
  timestamp,
  compactTask,
  providerPayload,
  estimateTokens,
  prepareContext,
};
