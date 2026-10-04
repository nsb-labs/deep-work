import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from './components/Markdown';
import { CliConsole } from './components/CliConsole';
import { TaskChat } from './components/TaskChat';
import { Settings } from './components/Settings';
import { TaskEditor } from './components/TaskEditor';
import { MemoryFact } from './components/MemoryFact';
import type { Snapshot, Task, TaskDetail, Message, TaskStatus } from './lib/workTypes';

const statuses: TaskStatus[] = ['open', 'in_progress', 'waiting_on', 'done', 'dismissed'];
const label = (s: string) => s.replace(/_/g, ' ');
const date = (s: string) => new Date(s).toLocaleString();
type Tab = 'work' | 'priority' | 'review' | 'memory' | 'jobs' | 'settings';

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [tab, setTab] = useState<Tab>('work');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<TaskDetail | null>(null),
    [mail, setMail] = useState<Message | null>(null);
  const [filter, setFilter] = useState('active'),
    [search, setSearch] = useState(''),
    [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(''),
    [notes, setNotes] = useState(''),
    [goal, setGoal] = useState(''),
    [waitingOn, setWaitingOn] = useState(''),
    [editingTask, setEditingTask] = useState(false);
  const detailSequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!window.workAPI)
      throw new Error(
        'Open DeepWork in Electron using npm run dev. The browser preview has no workspace service.',
      );
    const next = await window.workAPI.request<Snapshot>('snapshot');
    setSnapshot(next);
  }, []);
  const refreshDetail = useCallback(async (taskId: string) => {
    const sequence = ++detailSequence.current;
    const next = await window.workAPI.request<TaskDetail>('readTask', taskId);
    if (sequence === detailSequence.current) setDetail(next);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => refresh().catch((e) => setError(e.message)), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!selected) {
      ++detailSequence.current;
      setDetail(null);
      return;
    }
    refreshDetail(selected).catch((e) => setError(e.message));
  }, [
    selected,
    snapshot?.tasks.find((t) => t.id === selected)?.revision,
    snapshot?.jobs.find((j) => j.resultId)?.resultId,
    refreshDetail,
  ]);
  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(
      () => refreshDetail(selected).catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(timer);
  }, [selected, refreshDetail]);
  const action = async (operation: string, value?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const result = await window.workAPI.request(operation, value);
      await refresh();
      if (selected) await refreshDetail(selected);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const selectTask = (task: Task) => {
    setSelected(task.id);
    setMail(null);
    setEditingTask(false);
  };
  const openMail = async (m: Message) => {
    ++detailSequence.current;
    setSelected(null);
    setDetail(null);
    const result = await action('readMessage', m.id);
    if (result) setMail(result as Message);
  };
  const activeJobs =
    snapshot?.jobs.filter((j) => ['queued', 'running', 'awaiting_approval'].includes(j.status))
      .length || 0;
  const pending = snapshot?.messages.filter((m) => m.processedVersion !== m.version).length || 0;
  const tasks = (snapshot?.tasks || []).filter(
    (t) =>
      (filter === 'active'
        ? !['done', 'dismissed'].includes(t.status)
        : filter === 'all' || t.status === filter) &&
      `${t.title} ${t.owner} ${t.goal}`.toLowerCase().includes(search.toLowerCase()),
  );
  const counts = {
    work: snapshot?.tasks.filter((t) => !['done', 'dismissed'].includes(t.status)).length || 0,
    priority: snapshot?.messages.filter((m) => m.priorityReasons.length).length || 0,
    review: snapshot?.suggestions.length || 0,
    memory: snapshot?.facts.filter((f) => f.active).length || 0,
    jobs: activeJobs,
  };
  return (
    <div className="work-app" data-theme={snapshot?.settings.theme || 'dark'}>
      <header className="work-header">
        <div>
          <strong>DEEPWORK</strong>
          <span className="muted">Your work, remembered.</span>
        </div>
        <div className="actions">
          <button
            disabled={busy || !snapshot}
            aria-label={`Switch to ${snapshot?.settings.theme === 'light' ? 'dark' : 'light'} theme`}
            onClick={() => action('theme', snapshot?.settings.theme === 'light' ? 'dark' : 'light')}
          >
            {snapshot?.settings.theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <span className="mode-badge">
            {snapshot?.settings.mode === 'outlook' ? 'Classic Outlook' : 'Demo workspace'}
          </span>
          <button
            disabled={
              busy ||
              !snapshot ||
              !!snapshot.jobs.find(
                (j) =>
                  j.operation === 'sync' &&
                  ['queued', 'running', 'awaiting_approval'].includes(j.status),
              )
            }
            className="primary"
            onClick={() => action('sync')}
          >
            Sync mail
          </button>
        </div>
      </header>
      <div className="work-body">
        <nav className="work-nav">
          {(['work', 'priority', 'review', 'memory', 'jobs', 'settings'] as Tab[]).map((key) => (
            <button
              key={key}
              className={tab === key ? 'selected' : ''}
              onClick={() => {
                setTab(key);
                setSelected(null);
              }}
            >
              {
                {
                  work: 'My work',
                  priority: 'VIP & manager mail',
                  review: 'Review updates',
                  memory: 'Work memory',
                  jobs: 'Processing',
                  settings: 'Settings',
                }[key]
              }
              {key !== 'settings' && <span>{counts[key]}</span>}
            </button>
          ))}
          <div className="workspace-info">
            <span>Local workspace</span>
            <code>{snapshot?.workspace || 'Starting…'}</code>
            <button
              disabled={busy || !!activeJobs}
              onClick={async () => {
                try {
                  await window.workAPI.openWorkspace();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Choose folder
            </button>
            <button onClick={() => action('export')}>Rebuild Markdown</button>
          </div>
        </nav>
        <main className="work-main">
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          {notice && (
            <div className="alert" role="status">
              <pre>{notice}</pre>
              <button onClick={() => setNotice('')}>Dismiss</button>
            </div>
          )}
          {snapshot?.exportError && <div className="alert error">{snapshot.exportError}</div>}
          {snapshot?.sync?.warnings.map((w, i) => (
            <div className="alert warning" key={i}>
              {w}
            </div>
          ))}
          {pending > 0 && (
            <div className="processing-banner">
              {pending} email{pending === 1 ? '' : 's'} awaiting successful processing.{' '}
              <button disabled={busy} onClick={() => action('processPending')}>
                Process pending
              </button>
            </div>
          )}
          {!snapshot ? (
            <div className="empty">Starting the local workspace…</div>
          ) : selected ? (
            detail && detail.task.id === selected ? (
              <TaskChat
                key={selected}
                detail={detail}
                provider={snapshot.settings.provider}
                onSend={(userContext, sourceId) =>
                  action('chat', { taskId: selected, userContext, sourceId })
                }
                onStop={(jobId) => action('cancel', jobId)}
                onBack={() => {
                  setSelected(null);
                  setTab('work');
                }}
              />
            ) : (
              <p className="muted">Loading task conversation…</p>
            )
          ) : (
            <>
              {tab === 'work' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>My work</h1>
                      <p>Actions, goals, and the people you’re waiting on.</p>
                    </div>
                    <button onClick={() => setAdding(!adding)}>+ Add task</button>
                  </div>
                  {adding && (
                    <form
                      className="task-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const result = await action('addTask', { title, notes, goal, waitingOn });
                        if (result) {
                          setTitle('');
                          setNotes('');
                          setGoal('');
                          setWaitingOn('');
                          setAdding(false);
                          selectTask(result as Task);
                        }
                      }}
                    >
                      <input
                        aria-label="Task title"
                        required
                        maxLength={500}
                        placeholder="What needs to get done?"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                      <textarea
                        aria-label="Task notes"
                        placeholder="Context from a conversation or meeting"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                      <input
                        aria-label="Waiting-on person"
                        placeholder="Waiting on someone? Name or email (optional)"
                        value={waitingOn}
                        onChange={(e) => setWaitingOn(e.target.value)}
                      />
                      <select
                        aria-label="Task goal"
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                      >
                        <option value="">No goal</option>
                        {snapshot.settings.goals.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                      <button disabled={busy} type="submit" className="primary">
                        Create task
                      </button>
                    </form>
                  )}
                  <div className="filters">
                    <input
                      aria-label="Search tasks"
                      placeholder="Search your work…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                      aria-label="Filter tasks"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="active">Active work</option>
                      <option value="all">All work</option>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="task-list">
                    {tasks.map((t) => (
                      <button
                        className={`task-row ${selected === t.id ? 'selected' : ''}`}
                        key={t.id}
                        onClick={() => selectTask(t)}
                      >
                        <span className={`status-dot ${t.status}`} />
                        <div>
                          <h3>{t.title}</h3>
                          <div className="meta">
                            {t.owner || 'Unassigned'}
                            {t.waitingOn && ` · Waiting on ${t.waitingOn}`}
                            {t.goal && ` · ${t.goal}`}
                            {t.dueDate && ` · Due ${t.dueDate}`} ·{' '}
                            {t.provenance === 'user'
                              ? 'Manual task'
                              : `${t.evidenceIds.length} source(s)`}
                          </div>
                        </div>
                        <span className="status-pill">{label(t.status)}</span>
                      </button>
                    ))}
                  </div>
                  {!tasks.length && (
                    <div className="empty">
                      <h2>No work in this view</h2>
                      <p>
                        Add a task or sync mail. Start with demo mail to explore without
                        credentials.
                      </p>
                    </div>
                  )}
                </>
              )}
              {tab === 'priority' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>VIP & manager mail</h1>
                      <p>Visible immediately after extraction, even when AI processing fails.</p>
                    </div>
                  </div>
                  {!counts.priority && (
                    <div className="empty">
                      Add VIP and manager email addresses in Settings, then sync mail.
                    </div>
                  )}
                  {snapshot.messages
                    .filter((m) => m.priorityReasons.length)
                    .map((m) => (
                      <button key={m.id} className="task-row" onClick={() => openMail(m)}>
                        <div>
                          <h3>{m.subject || '(No subject)'}</h3>
                          <div className="meta">
                            {m.sender} · {date(m.receivedAt)}
                          </div>
                        </div>
                        <span className="status-pill">{m.priorityReasons.join(' / ')}</span>
                        <span className="meta">
                          {m.processedVersion === m.version ? 'Processed' : 'Unprocessed'}
                        </span>
                      </button>
                    ))}
                </>
              )}
              {tab === 'review' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Review updates</h1>
                      <p>
                        Confirm status changes and uncertain task matches using their source
                        evidence.
                      </p>
                    </div>
                  </div>
                  {!snapshot.suggestions.length && (
                    <div className="empty">No proposed updates to review.</div>
                  )}
                  {snapshot.suggestions.map((s) => (
                    <article className="memory-card" key={s.id}>
                      <h3>{s.change.title}</h3>
                      <div className="meta">
                        {s.change.taskId ? 'Update existing task' : 'Create a task'} ·{' '}
                        {label(s.change.status)} · confidence{' '}
                        {Math.round(s.change.confidence * 100)}%
                      </div>
                      <p>{s.change.reason}</p>
                      <div className="meta">
                        Owner: {s.change.owner || 'Unassigned'} · Waiting on:{' '}
                        {s.change.waitingOn || 'Nobody specified'} · Due:{' '}
                        {s.change.dueDate || 'Not specified'} · Goal: {s.change.goal || 'None'}
                      </div>
                      <div className="actions">
                        {s.change.evidenceIds.map((mid) => (
                          <button
                            key={mid}
                            onClick={() => {
                              const m = snapshot.messages.find((m) => m.id === mid);
                              if (m) openMail(m);
                            }}
                          >
                            Read source
                          </button>
                        ))}
                        <button
                          disabled={busy}
                          className="primary"
                          onClick={() => action('suggestion', { id: s.id, accept: true })}
                        >
                          Accept
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => action('suggestion', { id: s.id, accept: false })}
                        >
                          Dismiss
                        </button>
                      </div>
                    </article>
                  ))}
                </>
              )}
              {tab === 'memory' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Work memory</h1>
                      <p>
                        People, projects, and commitments connected to source excerpts. Review
                        inferred facts before relying on them.
                      </p>
                    </div>
                  </div>
                  {!counts.memory && (
                    <div className="empty">
                      Memory appears as email is processed and summarized.
                    </div>
                  )}
                  {snapshot.facts
                    .filter((f) => f.active)
                    .map((f) => (
                      <MemoryFact
                        key={f.id}
                        fact={f}
                        onUpdate={async (value) => {
                          await action('fact', value);
                        }}
                      />
                    ))}
                </>
              )}
              {tab === 'jobs' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Processing</h1>
                      <p>Jobs run one at a time. Failures stay visible and can be retried.</p>
                    </div>
                    <span>{activeJobs} active</span>
                  </div>
                  {snapshot.sync && (
                    <p className="muted">
                      Last scan: {date(snapshot.sync.at)} · {snapshot.sync.count} messages ·{' '}
                      {snapshot.sync.changed} changed
                    </p>
                  )}
                  {snapshot.jobs.map((j) => (
                    <article className="job-row" key={j.id}>
                      <div>
                        <h3>
                          {label(j.operation)}{' '}
                          <span className={`status-pill ${j.status}`}>{j.status}</span>
                        </h3>
                        <div className="meta">{date(j.createdAt)}</div>
                        {j.contextStats && (
                          <p className="meta">
                            {j.contextStats.estimatedTokens.toLocaleString()} estimated input tokens
                            / {j.contextStats.budget.toLocaleString()} budget ·{' '}
                            {j.contextStats.messageCount} emails ·{' '}
                            {j.contextStats.removedCharacters.toLocaleString()} repeated/footer
                            characters removed
                          </p>
                        )}
                        {j.error && <p className="job-error">{j.error}</p>}
                      </div>
                      <div className="actions">
                        {['queued', 'running', 'awaiting_approval'].includes(j.status) && (
                          <button onClick={() => action('cancel', j.id)}>Cancel</button>
                        )}
                        {['failed', 'cancelled', 'needs_attention'].includes(j.status) && (
                          <button onClick={() => action('retry', j.id)}>Retry</button>
                        )}
                      </div>
                    </article>
                  ))}
                </>
              )}
              {tab === 'settings' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Settings</h1>
                      <p>Windows + classic Outlook. No direct mailbox-server connection.</p>
                    </div>
                  </div>
                  <Settings
                    key={JSON.stringify({ ...snapshot.settings, theme: undefined })}
                    value={snapshot.settings}
                    onSave={async (p) => {
                      const result = await action('settings', {
                        ...p,
                        theme: snapshot.settings.theme,
                      });
                      if (result) setNotice('Settings saved.');
                    }}
                    onOperation={async (operation) => {
                      const result = await action(operation);
                      if (result) setNotice(JSON.stringify(result, null, 2));
                    }}
                  />
                </>
              )}
            </>
          )}
        </main>
        {(detail || mail) && (
          <aside className="work-detail">
            <div className="detail-heading">
              <span>{detail ? 'Work details' : 'Email source'}</span>
              <button
                onClick={() => {
                  ++detailSequence.current;
                  setSelected(null);
                  setDetail(null);
                  setMail(null);
                }}
              >
                Close
              </button>
            </div>
            {mail ? (
              <>
                <h2>{mail.subject}</h2>
                <div className="meta">
                  {mail.sender} · {date(mail.receivedAt)}
                </div>
                <pre className="email-body">{mail.body}</pre>
                {mail.account !== 'demo' && (
                  <button onClick={() => action('openSource', mail.id)}>Open in Outlook</button>
                )}
              </>
            ) : (
              detail && (
                <>
                  <h2>{detail.task.title}</h2>
                  <button onClick={() => setEditingTask(!editingTask)}>
                    {editingTask ? 'Cancel editing' : 'Edit task'}
                  </button>
                  {editingTask && snapshot && (
                    <TaskEditor
                      key={`${detail.task.id}-${detail.task.revision}`}
                      task={detail.task}
                      goals={snapshot.settings.goals}
                      onSave={async (value) => {
                        const result = await action('editTask', value);
                        if (result) setEditingTask(false);
                      }}
                    />
                  )}
                  <div className="meta">
                    {detail.task.provenance} · revision {detail.task.revision}
                  </div>
                  <label>
                    Status
                    <select
                      value={detail.task.status}
                      disabled={busy}
                      onChange={(e) =>
                        action('status', {
                          taskId: detail.task.id,
                          revision: detail.task.revision,
                          status: e.target.value,
                        })
                      }
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {detail.task.waitingOn && <p>Waiting on: {detail.task.waitingOn}</p>}
                  {detail.task.notes && <p>{detail.task.notes}</p>}
                  <h3>Sources</h3>
                  {detail.messages.length ? (
                    detail.messages.map((m) => (
                      <details key={m.id}>
                        <summary>
                          {m.subject} · {m.sender}
                        </summary>
                        <div className="meta">{date(m.receivedAt)}</div>
                        <pre className="email-body">{m.body}</pre>
                        {m.account !== 'demo' && (
                          <button onClick={() => action('openSource', m.id)}>
                            Open in Outlook
                          </button>
                        )}
                      </details>
                    ))
                  ) : (
                    <p className="muted">Manual task. Notes provide its context.</p>
                  )}
                  {detail.artifacts.length > 0 && <h3>Summaries & drafts</h3>}
                  {detail.artifacts.map((a) => (
                    <article className="artifact" key={a.id}>
                      <div className="meta">
                        {a.operation} · {a.provider} · {date(a.createdAt)} · {a.memoryIds.length}{' '}
                        memory facts
                        {a.taskRevision !== detail.task.revision && ' · Earlier task revision'}
                      </div>
                      <Markdown text={a.text} />
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(a.text);
                            setNotice('Copied to clipboard.');
                          } catch {
                            setError('Could not copy. Select the text and copy it manually.');
                          }
                        }}
                      >
                        Copy text
                      </button>
                    </article>
                  ))}
                  <h3>Status history</h3>
                  {detail.task.history.map((h, i) => (
                    <p className="meta" key={i}>
                      {date(h.at)} · {label(h.status)} · {h.reason}
                    </p>
                  ))}
                </>
              )
            )}
          </aside>
        )}
      </div>
      {snapshot && (
        <CliConsole
          sessions={snapshot.sessions || []}
          provider={snapshot.settings.provider}
          jobs={snapshot.jobs}
          onDecision={(value) => action('permission', value)}
          onStop={(jobId) => action('cancel', jobId)}
          onRetry={(jobId) => action('retry', jobId)}
          onDismiss={(jobId) => action('dismissAttention', jobId)}
        />
      )}
      <footer className="work-footer">
        <span>
          {activeJobs ? `${activeJobs} processing jobs` : 'Ready'} · {snapshot?.tasks.length || 0}{' '}
          tasks · {snapshot?.messages.length || 0} cached messages
        </span>
        <span>Local work storage · AI processing follows your CLI configuration</span>
      </footer>
    </div>
  );
}
export default App;
