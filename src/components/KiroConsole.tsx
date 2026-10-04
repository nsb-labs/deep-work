import React, { useEffect, useRef, useState } from 'react';
import type { Job, KiroSession } from '../lib/workTypes';

export function KiroConsole({
  sessions,
  jobs,
  onDecision,
  onStop,
  onRetry,
  onDismiss,
}: {
  sessions: KiroSession[];
  jobs: Job[];
  onDecision: (value: { jobId: string; requestId: string; optionId: string }) => Promise<unknown>;
  onStop: (jobId: string) => Promise<unknown>;
  onRetry: (jobId: string) => Promise<unknown>;
  onDismiss: (jobId: string) => Promise<unknown>;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState('');
  const seen = useRef(new Set<string>());
  const failures = jobs.filter(
    (job) => job.status === 'needs_attention' && !job.retriedBy && !job.attentionDismissed,
  );
  const attentionIds = [
    ...sessions.flatMap((s) => s.requests.map((r) => r.requestId)),
    ...failures.map((j) => j.id),
  ];
  const attentionKey = attentionIds.join(',');
  useEffect(() => {
    const ids = attentionKey.split(',').filter(Boolean);
    if (ids.some((id) => !seen.current.has(id))) setExpanded(true);
    ids.forEach((id) => seen.current.add(id));
  }, [attentionKey]);
  return (
    <section className="kiro-console" aria-label="Kiro console">
      <button
        className="console-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▾ Hide' : '▸ Open'} Kiro console ·{' '}
        {attentionIds.length
          ? `Attention required (${attentionIds.length})`
          : sessions.length
            ? 'Session running'
            : 'No active session'}
      </button>
      {expanded && (
        <div className="console-body">
          <p className="muted">
            Live Kiro session output and permission choices. Requests expire after five minutes.
            Hiding this panel keeps the session running.
          </p>
          {!sessions.length && !failures.length && (
            <p className="muted">
              No active Kiro session. Output appears here when Kiro runs a task or processes email.
            </p>
          )}
          {sessions.map((session) => (
            <article key={session.jobId}>
              <div className="actions">
                <strong>
                  {jobs.find((job) => job.id === session.jobId)?.operation || 'Kiro'} ·{' '}
                  {session.jobId.slice(0, 8)}
                </strong>
                <button onClick={() => onStop(session.jobId)}>Stop session</button>
              </div>
              <pre className="console-output" aria-live="polite">
                {session.transcript || 'Connecting to Kiro…'}
              </pre>
              {session.answer && <pre className="console-output">{session.answer}</pre>}
              {session.requests.map((request) => (
                <div className="permission-card" key={request.requestId}>
                  <h3>{request.title}</h3>
                  <p>Only approve actions you intend. This choice applies to this request.</p>
                  <pre className="console-output">{request.details}</pre>
                  <div className="actions">
                    {request.options.map((option) => (
                      <button
                        key={option.optionId}
                        disabled={!!submitting}
                        className={option.kind === 'allow_once' ? 'primary' : ''}
                        onClick={async () => {
                          setSubmitting(request.requestId);
                          try {
                            await onDecision({
                              jobId: session.jobId,
                              requestId: request.requestId,
                              optionId: option.optionId,
                            });
                          } finally {
                            setSubmitting('');
                          }
                        }}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </article>
          ))}
          {failures.map((job) => (
            <article key={job.id} className="permission-card">
              <h3>{job.operation} needs attention</h3>
              <p>{job.error}</p>
              <p className="muted">
                If Kiro needs login, run kiro-cli login in your configured native or WSL
                environment, then retry. A retry starts a new session; it cannot approve the
                previous run.
              </p>
              <div className="actions">
                <button onClick={() => onRetry(job.id)}>Retry job</button>
                <button onClick={() => onDismiss(job.id)}>Dismiss notice</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
