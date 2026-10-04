const { hash } = require('../core/contracts.cjs');
function demoMessages() {
  const stamp = new Date().toISOString();
  const samples = [
    [
      'manager@example.test',
      'Prepare launch readiness update',
      'Please prepare a launch readiness update for Friday. Include risks and next steps.',
      'Launch readiness',
    ],
    [
      'partner@example.test',
      'Waiting for the revised proposal',
      'I will send the revised proposal on Thursday. Please wait for my update.',
      'Proposal',
    ],
    [
      'colleague@example.test',
      'Review the onboarding checklist',
      'Could you review the onboarding checklist and share feedback?',
      'Onboarding',
    ],
  ];
  return samples.map(([sender, subject, body, topic], index) => ({
    account: 'demo',
    storeId: 'demo',
    providerId: `demo-${index}`,
    internetId: `<demo-${index}@example.test>`,
    threadId: hash(topic),
    folder: 'Demo Inbox',
    sender,
    recipients: ['me@example.test'],
    subject,
    body,
    receivedAt: stamp,
    modifiedAt: '2026-10-03T12:00:00.000Z',
    isSent: false,
  }));
}
function demoResult(input) {
  const m = input.messages[0];
  if (input.operation === 'draft')
    return {
      text: `Demo draft — review before use\n\nThanks for the update about ${m?.subject || input.task.title}. I’ll review the details and follow up.\n\n${input.userContext || ''}`,
      changes: [],
      facts: [],
    };
  if (input.operation === 'summarize')
    return {
      text: `## Demo summary\n\n${input.messages.map((m) => `- ${m.sender}: ${m.body}`).join('\n') || input.task.notes || input.task.title}\n\nRelevant memory: ${input.memory.length} facts. This is a deterministic demo, not AI inference.`,
      changes: [],
      facts: [],
    };
  const changes = [],
    facts = [];
  for (const source of input.messages.filter(
    (m) => !input.processedMessageIds || input.processedMessageIds.includes(m.id),
  )) {
    const existing = input.tasks.find((t) => t.evidenceIds.includes(source.id));
    const change = {
      taskId: existing?.id || '',
      title: source.subject,
      status: source.body.includes('Please wait') ? 'waiting_on' : 'open',
      owner: 'Me',
      waitingOn: source.body.includes('Please wait') ? source.sender : '',
      dueDate: '',
      goal: input.settings.goals[0] || '',
      evidenceIds: [source.id],
      confidence: 0.9,
      reason: 'Extracted from the synthetic demo message',
    };
    const prior = existing && changes.findIndex((c) => c.taskId === existing.id);
    if (existing && prior >= 0) changes[prior] = change;
    else changes.push(change);
    facts.push({
      subject: source.sender,
      relation: 'discusses',
      object: source.subject,
      evidenceId: source.id,
      quote: source.body.slice(0, 1800),
      confidence: 0.9,
    });
  }
  return { text: 'Demo classification', changes, facts };
}
module.exports = { demoMessages, demoResult };
