import { useState } from 'react';
import type { Fact } from '../lib/workTypes';
const date = (s: string) => new Date(s).toLocaleString();

export function MemoryFact({
  fact,
  onUpdate,
}: {
  fact: Fact;
  onUpdate: (value: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(fact.subject),
    [relation, setRelation] = useState(fact.relation),
    [object, setObject] = useState(fact.object);
  return (
    <article className="memory-card">
      {editing ? (
        <div className="inline-form">
          <input
            aria-label="Fact subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <input
            aria-label="Fact relation"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
          />
          <input
            aria-label="Fact object"
            value={object}
            onChange={(e) => setObject(e.target.value)}
          />
          <button
            onClick={async () => {
              await onUpdate({ id: fact.id, subject, relation, object });
              setEditing(false);
            }}
          >
            Confirm correction
          </button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <h3>
          {fact.subject} <span className="muted">→ {fact.relation} →</span> {fact.object}
        </h3>
      )}
      <div className="meta">
        {fact.provenance} · confidence {Math.round(fact.confidence * 100)}% ·{' '}
        {date(fact.sourceDate)}
      </div>
      <blockquote>{fact.quote}</blockquote>
      <div className="meta">Source: {fact.evidenceId}</div>
      <div className="actions">
        <button onClick={() => setEditing(true)}>Review / correct</button>
        <button onClick={() => onUpdate({ id: fact.id, active: false })}>Forget fact</button>
      </div>
    </article>
  );
}
