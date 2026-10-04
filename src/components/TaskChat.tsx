import { useEffect, useRef, useState } from 'react';
import type { ChatEvent, TaskDetail } from '../lib/workTypes';
import { Markdown } from './Markdown';

export function TaskChat({
  detail,
  provider,
  onSend,
  onStop,
  onBack,
}: {
  detail: TaskDetail;
  provider: string;
  onSend: (question: string, sourceId: string) => Promise<unknown>;
  onStop: (jobId: string) => Promise<unknown>;
  onBack: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sending, setSending] = useState(false);
  const [streams, setStreams] = useState<Record<string, ChatEvent>>({});
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(
    () =>
      window.workAPI.onChatEvent((event) => {
        if (event.taskId === detail.task.id)
          setStreams((previous) => ({ ...previous, [event.jobId]: event }));
      }),
    [detail.task.id],
  );
  const conversation = detail.conversation.map((message) => {
    const event = message.role === 'assistant' ? streams[message.jobId] : null;
    return event ? { ...message, ...event } : message;
  });
  const active = conversation.find(
    (m) => m.role === 'assistant' && ['queued', 'running'].includes(m.status),
  );
  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: 'nearest' });
  }, [detail.conversation, streams]);
  const send = async (text = question) => {
    if (!text.trim() || sending || active) return;
    setSending(true);
    follow.current = true;
    try {
      if (await onSend(text, sourceId)) setQuestion('');
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="task-chat" aria-label="Task chat">
      <div className="page-heading">
        <div>
          <h1>{detail.task.title}</h1>
          <p>
            Task conversation ·{' '}
            {provider === 'demo' ? 'Demo' : provider === 'kiro' ? 'Kiro CLI' : 'Codex CLI'}
          </p>
        </div>
        <button onClick={onBack}>Back to work</button>
      </div>
      <details className="chat-context">
        <summary>
          Context: this task · {detail.messages.length} email sources · {detail.memory.length}{' '}
          memory facts
        </summary>
        <p className="muted">
          Each turn uses the latest task and email, a small set of related memory, and recent
          conversation within your context budget. Include a specific older email below when needed.
          Chat answers are saved as conversation.
        </p>
        {!!detail.messages.length && (
          <label>
            Include a specific email in the next message
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Automatic · recent context</option>
              {detail.messages.map((m) => (
                <option key={m.id} value={m.id}>
                  {new Date(m.isSent && m.sentAt ? m.sentAt : m.receivedAt).toLocaleString()} ·{' '}
                  {m.sender} · {m.subject}
                </option>
              ))}
            </select>
          </label>
        )}
        {detail.memory.map((fact) => (
          <p key={fact.id}>
            {fact.subject} → {fact.relation} → {fact.object}
            <span className="meta">
              {' '}
              · {fact.provenance} · {fact.evidenceId || 'user'}
            </span>
          </p>
        ))}
      </details>
      <div
        className="chat-messages"
        ref={scroller}
        role="log"
        aria-label="Task conversation"
        onScroll={() => {
          const el = scroller.current;
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {!conversation.length && (
          <div className="empty">
            <h2>Work through this task</h2>
            <p>Ask about the next step, a deadline, a summary, or a reply.</p>
            <div className="actions chat-starters">
              <button
                onClick={() => void send('Summarize this task and identify the next action.')}
                disabled={sending}
              >
                Summarize task
              </button>
              <button
                onClick={() =>
                  void send('Draft a reply using the task, email thread, and relevant memory.')
                }
                disabled={sending}
              >
                Draft a reply
              </button>
            </div>
          </div>
        )}
        {conversation.map((message) => (
          <article className={`chat-message ${message.role}`} key={message.id}>
            <div className="meta">
              {message.role === 'user'
                ? 'You'
                : message.provider === 'demo'
                  ? 'DeepWork demo'
                  : message.provider === 'kiro'
                    ? 'Kiro CLI'
                    : 'Codex CLI'}{' '}
              · {new Date(message.createdAt).toLocaleTimeString()}
            </div>
            {message.text ? (
              <Markdown text={message.text} />
            ) : (
              <p className="muted">
                {message.status === 'queued'
                  ? 'Queued…'
                  : message.status === 'running'
                    ? 'Thinking…'
                    : 'No response text.'}
              </p>
            )}
            {message.status === 'running' && <span className="muted">Receiving response…</span>}
            {message.error && <p className="job-error">{message.error}</p>}
            {['failed', 'cancelled'].includes(message.status) && (
              <p className="muted">
                {message.status === 'cancelled' ? 'Stopped' : 'Failed'} · Any text above is an
                incomplete answer.
              </p>
            )}
          </article>
        ))}
        <div ref={end} />
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="task-chat-question">Message about this task</label>
        <textarea
          id="task-chat-question"
          placeholder="Ask a question about this task…"
          maxLength={10000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="actions">
          <span className="muted">Enter to send · Shift+Enter for a new line</span>
          {active ? (
            <button type="button" onClick={() => void onStop(active.jobId)}>
              Stop response
            </button>
          ) : (
            <button className="primary" disabled={sending || !question.trim()} type="submit">
              {sending ? 'Sending…' : 'Send message'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
