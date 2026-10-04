// Evidence-linked retrieval, deliberately independent of an AI provider.
function retrieveMemory(store, messages, tasks, limit = 30) {
  const sourceIds = new Set(messages.map((m) => m.id));
  const taskIds = new Set(tasks.map((t) => t.id));
  const terms = new Set(
    [
      ...messages.flatMap((m) => [m.sender, m.subject]),
      ...tasks.flatMap((t) => [t.title, t.goal, t.owner]),
    ]
      .join(' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}@._-]+/u)
      .filter((t) => t.length > 3),
  );
  return store
    .all('fact')
    .filter((f) => f.active)
    .map((f) => {
      const content = `${f.subject} ${f.relation} ${f.object}`.toLowerCase();
      const score =
        (sourceIds.has(f.evidenceId) ? 100 : 0) +
        (taskIds.has(f.taskId) ? 50 : 0) +
        [...terms].filter((t) => content.includes(t)).length;
      return { fact: f, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.fact);
}
module.exports = { retrieveMemory };
