const { AttentionSession } = require('./attention.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const {
  id,
  now,
  hash,
  text,
  list,
  oneOf,
  dateOnly,
  STATUSES,
  settings,
  message,
  validateResult,
} = require('./contracts.cjs');
const { exportMarkdown } = require('./markdown.cjs');
const { prepareContext, estimateTokens, providerPayload } = require('./context.cjs');
const { retrieveMemory } = require('./memory.cjs');
const { demoMessages, demoResult } = require('../connectors/demo.cjs');
const { outlookRequest } = require('../connectors/outlook.cjs');
const { discoverCli } = require('../providers/discovery.cjs');
const { runChat } = require('../providers/chat.cjs');
const { runCli, probe } = require('../providers/cli.cjs');

class WorkEngine {
  static async open(root, options = {}) {
    return new WorkEngine(await Store.open(root), options);
  }
  constructor(store, options) {
    this.store = store;
    this.options = options;
    this.busy = false;
    this.controller = null;
    this.closed = false;
    this.exportError = '';
    this.chatDrafts = new Map();
    this.sessions = new Map();
    this.store.transaction(() => {
      for (const job of store
        .all('job')
        .filter((j) => ['running', 'awaiting_approval'].includes(j.status))) {
        job.status = 'failed';
        job.error = 'Application stopped during this job. Retry explicitly.';
        job.finishedAt = now();
        store.put('job', job);
        if (job.operation === 'chat')
          this.finishChat(job, 'failed', 'Application stopped during this turn.');
      }
    });
    this.project();
    if (options.autoRun !== false) setImmediate(() => this.drain());
  }
  project() {
    try {
      exportMarkdown(this.store);
      this.exportError = '';
    } catch {
      this.exportError =
        'Markdown export failed. Database changes are saved; check workspace permissions and rebuild exports.';
    }
  }
  mutate(fn) {
    const result = this.store.transaction(fn);
    this.project();
    return result;
  }
  snapshot() {
    const p = this.store.preferences();
    return {
      workspace: this.store.root,
      platform: process.platform,
      settings: p,
      tasks: this.store.all('task'),
      messages: this.store.all('message').map(({ body, ...m }) => m),
      facts: this.store.all('fact'),
      suggestions: this.store.all('suggestion').filter((s) => s.status === 'pending'),
      jobs: this.store
        .all('job')
        .filter(
          (j, i, all) =>
            ['queued', 'running', 'awaiting_approval'].includes(j.status) || i >= all.length - 100,
        )
        .reverse()
        .map(({ payload, ...j }) => j),
      sessions: [...this.sessions.values()].map((session) => session.snapshot()),
      sync: this.store.get('sync', 'latest'),
      exportError: this.halted || this.exportError,
    };
  }
  saveSettings(value) {
    const p = settings(value);
    return this.mutate(() => {
      const old = this.store.preferences();
      if (
        old.lookbackDays !== p.lookbackDays ||
        JSON.stringify(old.folders) !== JSON.stringify(p.folders)
      )
        this.store.remove('syncCursor', 'outlook');
      this.store.put('settings', { id: 'preferences', ...p });
      for (const m of this.store.all('message')) {
        m.priorityReasons = this.priority(m, p);
        this.store.put('message', m);
      }
      this.store.event('settings-updated', 'preferences');
      return p;
    });
  }
  setTheme(value) {
    const theme = oneOf(value, ['dark', 'light'], 'theme');
    return this.mutate(() => {
      this.store.put('settings', { id: 'preferences', ...this.store.preferences(), theme });
      return theme;
    });
  }
  priority(m, p = this.store.preferences()) {
    const sender = m.sender.toLowerCase();
    return [
      ...(p.managerEmails.includes(sender) ? ['Manager'] : []),
      ...(p.vipEmails.includes(sender) ? ['VIP'] : []),
    ];
  }
  addTask(value) {
    const task = {
      id: id(),
      title: text(value.title, 'task title', 500),
      notes: text(value.notes ?? '', 'notes', 10000, true),
      owner: text(value.owner ?? 'Me', 'owner', 500, true),
      goal: text(value.goal ?? '', 'goal', 300, true),
      waitingOn: text(value.waitingOn ?? '', 'waiting-on person', 500, true),
      dueDate: '',
      status: value.waitingOn ? 'waiting_on' : 'open',
      provenance: 'user',
      evidenceIds: [],
      revision: 1,
      createdAt: now(),
      updatedAt: now(),
      history: [],
    };
    if (task.goal && !this.store.preferences().goals.includes(task.goal))
      throw new Error('Select a configured goal');
    task.history.push({ at: now(), status: task.status, reason: 'User created task' });
    return this.mutate(() => {
      this.store.put('task', task);
      this.store.event('task-created', task.id);
      return task;
    });
  }
  editTask(value) {
    return this.mutate(() => {
      const task = this.requireTask(value.taskId);
      if (task.revision !== value.revision)
        throw new Error('Task changed. Refresh before editing it.');
      const fields = {
        title: text(value.title, 'task title', 500),
        notes: text(value.notes ?? '', 'notes', 10000, true),
        owner: text(value.owner ?? '', 'owner', 500, true),
        waitingOn: text(value.waitingOn ?? '', 'waiting-on person', 500, true),
        goal: text(value.goal ?? '', 'goal', 300, true),
        dueDate: dateOnly(value.dueDate ?? ''),
      };
      if (
        fields.goal &&
        fields.goal !== task.goal &&
        !this.store.preferences().goals.includes(fields.goal)
      )
        throw new Error('Select a configured goal');
      const before = Object.fromEntries(Object.keys(fields).map((key) => [key, task[key]]));
      Object.assign(task, fields, {
        revision: task.revision + 1,
        updatedAt: now(),
        editedByUser: true,
      });
      task.history.push({ at: now(), status: task.status, reason: 'User edited task details' });
      this.store.put('task', task);
      this.store.event('task-edited', task.id, { before, after: fields });
      return task;
    });
  }
  setStatus(value) {
    const status = oneOf(value.status, STATUSES, 'status');
    return this.mutate(() => {
      const task = this.requireTask(value.taskId);
      if (task.revision !== value.revision)
        throw new Error('Task changed. Refresh before updating it.');
      task.status = status;
      task.revision++;
      task.updatedAt = now();
      task.history.push({ at: now(), status, reason: 'User changed status' });
      this.store.put('task', task);
      this.store.event('task-status', task.id, { status });
      return task;
    });
  }
  requireTask(taskId) {
    const t = this.store.get('task', text(taskId, 'task ID', 100));
    if (!t) throw new Error('Task not found');
    return t;
  }
  readTask(taskId) {
    const task = this.requireTask(taskId);
    return {
      task,
      messages: this.store
        .all('message')
        .filter(
          (m) =>
            task.evidenceIds.includes(m.id) ||
            this.taskThreads(task).has(hash([m.account, m.threadId])),
        ),
      conversation: this.store
        .all('chat')
        .filter((c) => c.taskId === task.id)
        .map((c) => ({ ...c, text: this.chatDrafts.get(c.id) ?? c.text })),
      memory: retrieveMemory(
        this.store,
        this.store.all('message').filter((m) => task.evidenceIds.includes(m.id)),
        [task],
      ),
      artifacts: this.store
        .all('artifact')
        .filter((a) => a.taskId === task.id)
        .slice(-20)
        .reverse(),
    };
  }
  taskThreads(task) {
    return new Set(
      task.evidenceIds
        .map((mid) => this.store.get('message', mid))
        .filter(Boolean)
        .map((m) => hash([m.account, m.threadId])),
    );
  }
  readMessage(messageId) {
    const m = this.store.get('message', text(messageId, 'message ID', 100));
    if (!m) throw new Error('Message not found');
    return m;
  }
  ingest(rawMessages, warnings = [], folders = []) {
    if (!Array.isArray(rawMessages) || rawMessages.length > 5000)
      throw new Error('Invalid mail batch');
    // Normalize all records before mutation, so an invalid batch cannot leave a partial scan.
    warnings = list(warnings, 'scan warnings', 100).map((w) => text(w, 'scan warning', 2000));
    folders = list(folders, 'scan folders', 100).map((f) => text(f, 'scan folder', 1000));
    const normalized = rawMessages.map(message);
    const changed = [];
    this.mutate(() => {
      for (const m of normalized) {
        const old = this.store.get('message', m.id);
        if (old && message(old).contentHash === m.contentHash) m.version = old.version;
        if (old && old.version !== m.version) {
          this.store.put('sourceRevision', {
            ...old,
            id: hash([old.id, old.version]),
            messageId: old.id,
          });
          for (const fact of this.store
            .all('fact')
            .filter(
              (f) =>
                f.evidenceId === old.id &&
                f.evidenceVersion === old.version &&
                f.provenance === 'email-extracted',
            )) {
            fact.active = false;
            fact.supersededAt = now();
            this.store.put('fact', fact);
          }
        }
        m.processedVersion = old?.processedVersion || '';
        m.priorityReasons = this.priority(m);
        m.ingestedAt = now();
        if (!old || old.version !== m.version) changed.push(m.id);
        this.store.put('message', m);
      }
      this.store.put('sync', {
        id: 'latest',
        at: now(),
        count: normalized.length,
        changed: changed.length,
        warnings,
        folders,
      });
      this.store.event('mail-ingested', 'latest', {
        count: normalized.length,
        changed: changed.length,
      });
      // Open task evidence is pinned. Unprocessed messages are retained for retry as well.
      const pinned = new Set(
        this.store
          .all('task')
          .filter((t) => !['done', 'dismissed'].includes(t.status))
          .flatMap((t) => t.evidenceIds),
      );
      for (const proposal of this.store.all('suggestion').filter((s) => s.status === 'pending'))
        for (const mid of proposal.change.evidenceIds) pinned.add(mid);
      const facts = new Set(
        this.store
          .all('fact')
          .filter((f) => f.active)
          .map((f) => f.evidenceId),
      );
      const cutoff = Date.now() - this.store.preferences().retentionDays * 86400000;
      for (const m of this.store.all('message')) {
        if (
          Date.parse(m.receivedAt) < cutoff &&
          m.processedVersion === m.version &&
          !pinned.has(m.id) &&
          !facts.has(m.id)
        ) {
          this.store.remove('message', m.id);
        }
      }
      for (const revision of this.store.all('sourceRevision'))
        if (
          Date.parse(revision.receivedAt) < cutoff &&
          !pinned.has(revision.messageId) &&
          !this.store
            .all('fact')
            .some(
              (f) =>
                f.active &&
                f.evidenceId === revision.messageId &&
                f.evidenceVersion === revision.version,
            )
        )
          this.store.remove('sourceRevision', revision.id);
    });
    return changed;
  }
  enqueue(operation, payload = {}, persist = true) {
    oneOf(operation, ['sync', 'classify', 'summarize', 'draft', 'chat'], 'job operation');
    const p = this.store.preferences();
    if (operation !== 'sync' && p.provider === 'demo' && p.mode !== 'demo')
      throw new Error('Demo provider cannot process live mail. Choose your approved CLI.');
    if (operation !== 'sync' && p.provider !== 'demo' && !p.organizationApproved)
      throw new Error(
        'Confirm the CLI is approved for your organization’s email data in Settings.',
      );
    if (operation === 'summarize' || operation === 'draft' || operation === 'chat') {
      this.requireTask(payload.taskId);
      payload.userContext = text(payload.userContext ?? '', 'reply context', 10000, true);
    }
    if (operation === 'classify') {
      const m = this.readMessage(payload.messageId);
      if (m.account !== 'demo' && p.provider === 'demo')
        throw new Error('Demo provider cannot process real messages');
      if (
        this.store.all('job').some(
          (j) =>
            j.operation === 'classify' &&
            (() => {
              const source = this.store.get('message', j.payload.messageId);
              return source && source.account === m.account && source.threadId === m.threadId;
            })() &&
            ['queued', 'running', 'awaiting_approval'].includes(j.status),
        )
      )
        return null;
    }
    if (operation === 'chat') {
      payload.userContext = text(payload.userContext, 'chat message', 10000);
      payload.sourceId = text(payload.sourceId ?? '', 'selected email ID', 100, true);
      if (
        this.store
          .all('job')
          .some(
            (j) =>
              j.operation === 'chat' &&
              j.payload.taskId === payload.taskId &&
              ['queued', 'running', 'awaiting_approval'].includes(j.status),
          )
      )
        throw new Error('Wait for this task’s current chat turn or stop it first.');
    }
    if (this.halted) throw new Error(this.halted);
    const job = {
      id: id(),
      operation,
      payload,
      settings: p,
      status: 'queued',
      createdAt: now(),
      error: '',
      resultId: '',
    };
    if (persist)
      this.store.transaction(() => {
        this.store.put('job', job);
        if (operation === 'chat') {
          this.store.put('chat', {
            id: id(),
            taskId: payload.taskId,
            jobId: job.id,
            role: 'user',
            text: payload.userContext,
            status: 'completed',
            createdAt: now(),
            provider: p.provider,
          });
          this.store.put('chat', {
            id: job.id,
            taskId: payload.taskId,
            jobId: job.id,
            role: 'assistant',
            text: '',
            status: 'queued',
            createdAt: now(),
            provider: p.provider,
          });
        }
      });
    else this.store.put('job', job);
    if (persist && operation === 'chat') this.project();
    if (persist && this.options.autoRun !== false) setImmediate(() => this.drain());
    return job.id;
  }
  processPending() {
    const pending = this.store.all('message').filter((m) => m.processedVersion !== m.version);
    const threads = [...new Map(pending.map((m) => [hash([m.account, m.threadId]), m])).values()];
    const jobs = this.store.transaction(() =>
      threads.map((m) => this.enqueue('classify', { messageId: m.id }, false)).filter(Boolean),
    );
    if (this.options.autoRun !== false) setImmediate(() => this.drain());
    return jobs;
  }
  cancel(jobId) {
    const result = this.mutate(() => {
      const job = this.store.get('job', text(jobId, 'job ID', 100));
      if (!job || !['queued', 'running', 'awaiting_approval'].includes(job.status))
        throw new Error('Job is not cancellable');
      job.status = 'cancelled';
      job.finishedAt = now();
      this.store.put('job', job);
      if (job.operation === 'chat') this.finishChat(job, 'cancelled', 'Stopped by user.');
    });
    if (this.activeId === jobId) this.controller?.abort();
    if (this.syncId === jobId) this.syncController?.abort();
    return result;
  }
  retry(jobId) {
    const job = this.store.get('job', text(jobId, 'job ID', 100));
    if (!job || !['failed', 'cancelled', 'needs_attention'].includes(job.status))
      throw new Error('Job is not retryable');
    const retryId = this.enqueue(job.operation, { ...job.payload });
    if (retryId)
      this.store.transaction(() => {
        job.retriedBy = retryId;
        this.store.put('job', job);
      });
    return retryId;
  }
  buildInput(job) {
    const task = job.payload.taskId ? this.requireTask(job.payload.taskId) : null;
    const messageRecord = job.payload.messageId ? this.readMessage(job.payload.messageId) : null;
    const messages = task
      ? this.readTask(task.id).messages
      : this.store
          .all('message')
          .filter(
            (m) => m.account === messageRecord.account && m.threadId === messageRecord.threadId,
          );
    const conversation =
      job.operation === 'chat'
        ? this.store
            .all('chat')
            .filter(
              (c) =>
                c.taskId === task.id &&
                c.jobId !== job.id &&
                c.status === 'completed' &&
                this.store.get('job', c.jobId)?.status === 'succeeded',
            )
            .slice(-20)
            .map(({ role, text }) => ({ role, text }))
        : [];
    const requiredIds =
      job.operation === 'classify'
        ? messages.filter((m) => m.processedVersion !== m.version).map((m) => m.id)
        : [];
    return prepareContext(this.store, {
      operation: job.operation,
      settings: job.settings,
      task,
      messages,
      requiredIds,
      conversation,
      userContext: job.payload.userContext || '',
      sourceId: job.payload.sourceId || '',
    });
  }
  applyResult(job, input, raw) {
    const result = validateResult(raw, input);
    for (const fact of result.facts)
      if (!this.readMessage(fact.evidenceId).body.includes(fact.quote))
        throw new Error('Fact must cite a verbatim original source excerpt');
    const mutations = result.changes;
    this.mutate(() => {
      // Check revisions even for derived artifacts: a stale draft/summary should not look current.
      for (const original of input.tasks)
        if (this.requireTask(original.id).revision !== original.revision)
          throw new Error('Task changed while AI was running. Retry with current context.');
      for (const original of input.messages)
        if (this.readMessage(original.id).version !== original.version)
          throw new Error('Email changed while AI was running. Retry with current context.');
      for (const c of mutations) {
        const existing = c.taskId ? this.requireTask(c.taskId) : null;
        const fields = ['title', 'status', 'owner', 'waitingOn', 'goal', 'dueDate'];
        if (
          existing &&
          fields.every((key) => (existing[key] || '') === c[key]) &&
          c.evidenceIds.every((mid) => existing.evidenceIds.includes(mid))
        )
          continue;
        const signature = hash([
          c,
          [...c.evidenceIds].sort().map((mid) => [mid, this.readMessage(mid).version]),
        ]);
        if (this.store.all('suggestion').some((s) => s.signature === signature)) continue;
        const linkedTasks = input.tasks.filter((t) =>
          c.evidenceIds.some((mid) => t.evidenceIds.includes(mid)),
        );
        if (
          !c.taskId &&
          c.confidence >= 0.85 &&
          !linkedTasks.length &&
          !['done', 'dismissed'].includes(c.status)
        ) {
          const task = {
            id: id(),
            title: c.title,
            status: c.status,
            owner: c.owner,
            waitingOn: c.waitingOn,
            goal: c.goal,
            dueDate: c.dueDate,
            notes: c.reason,
            evidenceIds: c.evidenceIds,
            provenance: 'email-extracted',
            revision: 1,
            createdAt: now(),
            updatedAt: now(),
            history: [{ at: now(), status: c.status, reason: c.reason }],
          };
          this.store.put('task', task);
          this.store.event('task-created', task.id, { provenance: 'email-extracted' });
        } else {
          this.store.put('suggestion', {
            id: id(),
            signature,
            status: 'pending',
            change: c,
            taskRevision: c.taskId ? this.requireTask(c.taskId).revision : null,
            sourceVersions: Object.fromEntries(
              c.evidenceIds.map((mid) => [mid, this.readMessage(mid).version]),
            ),
            createdAt: now(),
          });
        }
      }
      for (const f of result.facts) {
        const factId = hash([
          f.subject,
          f.relation,
          f.object,
          f.evidenceId,
          this.readMessage(f.evidenceId).version,
          f.quote,
        ]);
        if (!this.store.get('fact', factId))
          this.store.put('fact', {
            ...f,
            id: factId,
            active: true,
            provenance: 'email-extracted',
            evidenceVersion: this.readMessage(f.evidenceId).version,
            sourceDate: this.readMessage(f.evidenceId).receivedAt,
            createdAt: now(),
            taskId: input.task?.id || '',
          });
      }
      if (input.operation === 'classify') {
        for (const sourceId of input.processedMessageIds || [job.payload.messageId]) {
          const m = this.readMessage(sourceId);
          m.processedVersion = m.version;
          this.store.put('message', m);
        }
      } else {
        const artifact = {
          id: id(),
          taskId: input.task.id,
          taskRevision: input.task.revision,
          operation: job.operation,
          text: result.text,
          provider: job.settings.provider,
          createdAt: now(),
          evidenceIds: input.messages.map((m) => m.id),
          memoryIds: input.memory.map((f) => f.id),
          userContext: input.userContext,
        };
        this.store.put('artifact', artifact);
        job.resultId = artifact.id;
      }
      job.status = 'succeeded';
      job.finishedAt = now();
      this.store.put('job', job);
      this.store.event(job.operation, input.task?.id || job.payload.messageId);
    });
    if (job.resultId) {
      const artifact = this.store.get('artifact', job.resultId);
      try {
        const folder = artifact.operation === 'draft' ? 'drafts' : 'summaries';
        const { atomicWrite } = require('./store.cjs');
        atomicWrite(path.join(this.store.root, folder, `${artifact.id}.md`), artifact.text);
      } catch {
        this.exportError = 'Result saved in database, but its Markdown export failed.';
      }
    }
  }
  decideSuggestion(value) {
    return this.mutate(() => {
      const s = this.store.get('suggestion', text(value.id, 'suggestion ID', 100));
      if (!s || s.status !== 'pending') throw new Error('Suggestion is no longer pending');
      if (value.accept === true) {
        const c = s.change;
        for (const [mid, version] of Object.entries(s.sourceVersions))
          if (this.readMessage(mid).version !== version)
            throw new Error('Source changed; dismiss and reprocess this suggestion');
        let t;
        if (c.taskId) {
          t = this.requireTask(c.taskId);
          if (t.revision !== s.taskRevision)
            throw new Error(
              'Task changed since this suggestion. Dismiss it and reprocess the source.',
            );
        } else
          t = {
            id: id(),
            notes: '',
            provenance: 'email-confirmed',
            revision: 0,
            createdAt: now(),
            history: [],
            evidenceIds: [],
          };
        Object.assign(t, {
          title: c.title,
          status: c.status,
          owner: c.owner,
          waitingOn: c.waitingOn,
          goal: c.goal,
          dueDate: c.dueDate,
          updatedAt: now(),
          revision: t.revision + 1,
          evidenceIds: [...new Set([...t.evidenceIds, ...c.evidenceIds])],
        });
        t.history.push({ at: now(), status: t.status, reason: `User accepted: ${c.reason}` });
        this.store.put('task', t);
        this.store.event('task-status', t.id, { status: t.status });
        s.status = 'accepted';
      } else s.status = 'dismissed';
      this.store.put('suggestion', s);
    });
  }
  updateFact(value) {
    return this.mutate(() => {
      const f = this.store.get('fact', text(value.id, 'fact ID', 100));
      if (!f) throw new Error('Fact not found');
      const before = {
        subject: f.subject,
        relation: f.relation,
        object: f.object,
        active: f.active,
        provenance: f.provenance,
      };
      if (value.active === false) f.active = false;
      else {
        f.subject = text(value.subject, 'fact subject', 300);
        f.relation = text(value.relation, 'relation', 100);
        f.object = text(value.object, 'fact object', 1000);
        f.provenance = 'user-confirmed';
      }
      f.updatedAt = now();
      this.store.put('fact', f);
      this.store.event('memory-corrected', f.id, {
        before,
        after: {
          subject: f.subject,
          relation: f.relation,
          object: f.object,
          active: f.active,
          provenance: f.provenance,
        },
      });
    });
  }
  async sync(job, signal) {
    let response;
    if (job.settings.mode === 'demo')
      response = { messages: demoMessages(), warnings: [], folders: ['Demo Inbox'] };
    else {
      const openTasks = this.store
        .all('task')
        .filter((t) => !['done', 'dismissed'].includes(t.status));
      const trackedThreads = [
        ...new Map(
          openTasks
            .flatMap((t) => t.evidenceIds)
            .map((mid) => this.store.get('message', mid))
            .filter(Boolean)
            .map((m) => [
              hash([m.account, m.threadId]),
              { account: m.account, threadId: m.threadId },
            ]),
        ).values(),
      ];
      response = await (this.options.outlookRequest || outlookRequest)(
        {
          operation: 'sync',
          lookbackDays: job.settings.lookbackDays,
          maxMessages: job.settings.maxMessages,
          folders: job.settings.folders,
          trackedThreads,
          cursor: this.store.get('syncCursor', 'outlook')?.data || {},
        },
        this.store.root,
        this.options.outlookHelper || path.join(__dirname, '../connectors/outlook.ps1'),
        signal,
      );
    }
    if (signal.aborted) throw new Error('Cancelled');
    this.ingest(response.messages, response.warnings, response.folders);
    if (response.cursor)
      this.store.transaction(() =>
        this.store.put('syncCursor', { id: 'outlook', data: response.cursor }),
      );
    // Queue all pending versions, including sources from earlier failed jobs.
    const current = this.store.preferences();
    if (
      (current.provider !== 'demo' && current.organizationApproved) ||
      (current.provider === 'demo' && this.store.all('message').every((m) => m.account === 'demo'))
    )
      this.processPending();
    else
      this.mutate(() => {
        const scan = this.store.get('sync', 'latest');
        scan.warnings.push(
          'Email extracted. Choose an approved AI CLI in Settings, then process pending email.',
        );
        this.store.put('sync', scan);
      });
    this.mutate(() => {
      job.status = 'succeeded';
      job.finishedAt = now();
      this.store.put('job', job);
    });
  }
  finishChat(job, status, error = '') {
    const chat = this.store.get('chat', job.id);
    if (!chat) return;
    chat.text = this.chatDrafts.get(job.id) ?? chat.text;
    chat.status = status;
    chat.error = error;
    this.store.put('chat', chat);
    this.chatDrafts.delete(job.id);
    this.options.onChatEvent?.({
      taskId: chat.taskId,
      jobId: job.id,
      text: chat.text,
      status,
      error,
    });
  }
  async chatTurn(job, input, directory, providerOptions) {
    let lastPushAt = 0;
    const emit = (answer) => {
      if (this.controller.signal.aborted) return;
      if (typeof answer !== 'string' || Buffer.byteLength(answer) > 1024 * 1024)
        throw new Error('Chat response exceeded limit');
      this.chatDrafts.set(job.id, answer);
      if (Date.now() - lastPushAt < 35) return;
      lastPushAt = Date.now();
      this.options.onChatEvent?.({
        taskId: input.task.id,
        jobId: job.id,
        text: answer,
        status: 'running',
      });
    };
    let answer;
    if (this.options.runChat)
      answer = await this.options.runChat(
        input,
        directory,
        this.controller.signal,
        emit,
        providerOptions,
      );
    else if (job.settings.provider === 'demo') {
      answer = `Demo response for **${input.task.title}**.\n\nYour question: ${input.userContext}\n\nCurrent status: ${input.task.status}. ${input.memory.length} related memory facts and ${input.messages.length} email sources are available. Configure an approved CLI for an AI answer.`;
      for (let end = 24; end < answer.length + 24; end += 24) {
        if (this.controller.signal.aborted) throw new Error('Cancelled');
        emit(answer.slice(0, end));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } else answer = await runChat(input, directory, this.controller.signal, emit, providerOptions);
    if (this.controller.signal.aborted) throw new Error('Cancelled');
    if (!answer?.trim()) throw new Error('No chat response');
    emit(answer);
    this.mutate(() => {
      this.finishChat(job, 'completed');
      job.status = 'succeeded';
      job.finishedAt = now();
      job.resultId = job.id;
      this.store.put('job', job);
    });
  }
  async drain() {
    if (this.busy || this.closed || this.halted) return;
    this.busy = true;
    try {
      while (!this.closed && !this.halted) {
        const job = this.store
          .all('job')
          .find((j) => j.status === 'queued' && !(this.syncBusy && j.operation === 'sync'));
        if (!job) break;
        this.activeId = job.id;
        this.controller = new AbortController();
        this.store.transaction(() => {
          job.status = 'running';
          job.startedAt = now();
          this.store.put('job', job);
          if (job.operation === 'chat') {
            const chat = this.store.get('chat', job.id);
            chat.status = 'running';
            this.store.put('chat', chat);
          }
        });
        try {
          if (job.operation === 'sync') await this.sync(job, this.controller.signal);
          else {
            const input = this.buildInput(job);
            if (!input) {
              this.store.transaction(() => {
                job.status = 'succeeded';
                job.finishedAt = now();
                this.store.put('job', job);
              });
              continue;
            }
            this.store.transaction(() => {
              job.contextStats = {
                estimatedTokens: 2000 + estimateTokens(providerPayload(input)),
                budget: input.context.budget,
                messageCount: input.messages.length,
                pendingMessageCount: input.processedMessageIds.length,
                removedCharacters: input.messages.reduce((sum, m) => sum + m.removedCharacters, 0),
              };
              this.store.put('job', job);
            });
            if (
              job.settings.provider === 'demo' &&
              input.messages.some((m) => this.readMessage(m.id).account !== 'demo')
            )
              throw new Error('Demo provider cannot process real messages');
            const directory = path.join(this.store.root, 'jobs', job.id);
            fs.mkdirSync(directory, { recursive: true });
            const session = new AttentionSession(job.id, {
              signal: this.controller.signal,
              timeout: this.options.approvalTimeout || 300000,
              audit: (decision) =>
                this.store.transaction(() => this.store.event('kiro.permission', job.id, decision)),
              onChange: () => {
                const current = this.store.get('job', job.id);
                if (!['running', 'awaiting_approval'].includes(current.status)) return;
                const status = session.pending.size ? 'awaiting_approval' : 'running';
                if (current.status !== status)
                  this.store.transaction(() => {
                    current.status = status;
                    this.store.put('job', current);
                  });
              },
            });
            if (job.settings.provider === 'kiro') this.sessions.set(job.id, session);
            const providerOptions = {
              onConsole: (text) => session.log(text),
              onOutput: (text) => session.output(text),
              requestPermission: (value) => session.request(value),
            };
            try {
              if (job.operation === 'chat') {
                await this.chatTurn(job, input, directory, providerOptions);
                continue;
              }
              const result = this.options.runProvider
                ? await this.options.runProvider(
                    input,
                    directory,
                    this.controller.signal,
                    providerOptions,
                  )
                : job.settings.provider === 'demo'
                  ? demoResult(input)
                  : await runCli(input, directory, this.controller.signal, providerOptions);
              if (this.controller.signal.aborted) throw new Error('Cancelled');
              this.applyResult(job, input, result);
              if (job.operation === 'classify') {
                const source = this.readMessage(job.payload.messageId);
                const remainder = this.store
                  .all('message')
                  .find(
                    (m) =>
                      m.account === source.account &&
                      m.threadId === source.threadId &&
                      m.processedVersion !== m.version,
                  );
                const current = this.store.preferences();
                if (
                  remainder &&
                  ((current.provider !== 'demo' && current.organizationApproved) ||
                    (current.provider === 'demo' && remainder.account === 'demo'))
                )
                  this.enqueue('classify', { messageId: remainder.id });
              }
            } finally {
              session.close();
              this.sessions.delete(job.id);
              fs.rmSync(directory, { recursive: true, force: true });
            }
          }
        } catch (error) {
          if (error.terminationUnconfirmed) this.halted = error.message;
          this.store.transaction(() => {
            const current = this.store.get('job', job.id);
            if (current.status !== 'cancelled') {
              current.status =
                job.settings.provider === 'kiro' && !error.terminationUnconfirmed
                  ? 'needs_attention'
                  : 'failed';
              current.error = String(error.message || error).slice(0, 1000);
              current.finishedAt = now();
              this.store.put('job', current);
              if (job.operation === 'chat') this.finishChat(job, 'failed', current.error);
            }
          });
          if (job.operation === 'chat') this.project();
        }
      }
    } finally {
      this.busy = false;
      this.controller = null;
      this.activeId = null;
    }
  }
  async syncDuringApproval(jobId) {
    const job = this.store.get('job', jobId);
    if (!job || job.status !== 'queued' || this.syncBusy || this.closed) return;
    this.syncBusy = true;
    this.syncId = jobId;
    this.syncController = new AbortController();
    this.store.transaction(() => {
      job.status = 'running';
      job.startedAt = now();
      this.store.put('job', job);
    });
    try {
      await this.sync(job, this.syncController.signal);
    } catch (error) {
      if (error.terminationUnconfirmed) this.halted = error.message;
      this.store.transaction(() => {
        const current = this.store.get('job', jobId);
        if (current.status !== 'cancelled') {
          current.status = 'failed';
          current.error = String(error.message || error).slice(0, 1000);
          current.finishedAt = now();
          this.store.put('job', current);
        }
      });
    } finally {
      this.syncBusy = false;
      this.syncController = null;
      this.syncId = null;
      if (!this.closed) void this.drain();
    }
  }
  async openSource(messageId) {
    const m = this.readMessage(messageId);
    if (m.account === 'demo') throw new Error('Synthetic messages have no Outlook source');
    return outlookRequest(
      { operation: 'open', providerId: m.providerId, storeId: m.storeId },
      this.store.root,
      this.options.outlookHelper || path.join(__dirname, '../connectors/outlook.ps1'),
    );
  }
  async dispatch(operation, value) {
    switch (operation) {
      case 'snapshot':
        return this.snapshot();
      case 'theme':
        return this.setTheme(value);
      case 'settings':
        return this.saveSettings(value);
      case 'addTask':
        return this.addTask(value);
      case 'editTask':
        return this.editTask(value);
      case 'status':
        return this.setStatus(value);
      case 'readTask':
        return this.readTask(value);
      case 'readMessage':
        return this.readMessage(value);
      case 'sync': {
        const jobId = this.enqueue('sync');
        if ([...this.sessions.values()].some((session) => session.pending.size))
          void this.syncDuringApproval(jobId);
        return jobId;
      }
      case 'processPending':
        return this.processPending();
      case 'chat':
        return this.enqueue('chat', value);
      case 'summarize':
        return this.enqueue('summarize', value);
      case 'draft':
        return this.enqueue('draft', value);
      case 'cancel':
        return this.cancel(value);
      case 'dismissAttention': {
        const job = this.store.get('job', text(value, 'job ID', 100));
        if (!job || job.status !== 'needs_attention')
          throw new Error('Job does not need attention');
        return this.mutate(() => {
          job.attentionDismissed = true;
          this.store.put('job', job);
        });
      }
      case 'permission': {
        if (!value || typeof value.jobId !== 'string')
          throw new Error('Invalid permission decision');
        const session = this.sessions.get(value.jobId);
        if (!session) throw new Error('Kiro session is no longer active');
        return session.decide(value);
      }
      case 'retry':
        return this.retry(value);
      case 'suggestion':
        return this.decideSuggestion(value);
      case 'fact':
        return this.updateFact(value);
      case 'shutdown':
        this.close();
        return { closed: true };
      case 'openSource':
        return this.openSource(value);
      case 'discoverCli':
        // React remounts and repeated requests share one in-flight scan.
        if (!this.cliDiscovery)
          this.cliDiscovery = discoverCli().finally(() => {
            this.cliDiscovery = null;
          });
        return this.cliDiscovery;
      case 'probe': {
        const p = this.store.preferences();
        if (p.provider === 'demo')
          return { version: 'Built-in synthetic provider', note: 'No model or account required.' };
        return probe(p, this.store.root);
      }
      case 'folders':
        return outlookRequest(
          { operation: 'folders' },
          this.store.root,
          this.options.outlookHelper || path.join(__dirname, '../connectors/outlook.ps1'),
        );
      case 'export':
        this.project();
        return { error: this.exportError };
      default:
        throw new Error('Unknown operation');
    }
  }
  close() {
    this.closed = true;
    this.controller?.abort();
    this.syncController?.abort();
  }
}
module.exports = { WorkEngine };
