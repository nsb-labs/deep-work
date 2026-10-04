const { randomUUID } = require('node:crypto');

// Live callbacks never enter SQLite. A persisted approval cannot authorize a later process.
class AttentionSession {
  constructor(jobId, { onChange, audit, signal, timeout = 300000 }) {
    this.jobId = jobId;
    this.onChange = onChange;
    this.audit = audit;
    this.signal = signal;
    this.timeout = timeout;
    this.transcript = '';
    this.answer = '';
    this.pending = new Map();
  }
  log(text) {
    this.transcript = (this.transcript + String(text).slice(0, 4000) + '\n').slice(-16000);
    this.onChange();
  }
  output(text) {
    this.answer = String(text).slice(-16000);
  }
  snapshot() {
    return {
      jobId: this.jobId,
      transcript: this.transcript,
      answer: this.answer,
      requests: [...this.pending.values()].map(({ view }) => view),
    };
  }
  request(value) {
    if (this.signal.aborted) return Promise.resolve(null);
    const options = value.options.map(({ optionId, name, kind }) => {
      if (optionId.length > 200 || name.length > 500) throw new Error('Kiro choice exceeded limit');
      return { optionId, name, kind };
    });
    if (new Set(options.map((o) => o.optionId)).size !== options.length)
      throw new Error('Duplicate Kiro permission choices');
    if (this.pending.size >= 10) throw new Error('Too many Kiro permission requests');
    const requestId = randomUUID();
    const details = JSON.stringify(value.toolCall || {}, null, 2);
    if (Buffer.byteLength(details) > 16000)
      throw new Error('Kiro permission details exceeded limit');
    return new Promise((resolve) => {
      const finish = (optionId, reason) => {
        if (!this.pending.has(requestId)) return;
        clearTimeout(timer);
        this.signal.removeEventListener('abort', abort);
        this.pending.delete(requestId);
        try {
          this.audit({ requestId, optionId, reason });
          this.log(`Permission ${reason}.`);
          resolve(optionId);
        } catch {
          resolve(null); // Never grant access when the decision cannot be recorded.
        }
      };
      const abort = () => finish(null, 'cancelled');
      const timer = setTimeout(() => finish(null, 'expired'), this.timeout);
      this.pending.set(requestId, {
        view: {
          requestId,
          title: String(value.toolCall?.title || 'Kiro requests permission').slice(0, 500),
          details,
          options,
          expiresAt: new Date(Date.now() + this.timeout).toISOString(),
        },
        finish,
      });
      this.signal.addEventListener('abort', abort, { once: true });
      this.log('Kiro needs your attention. Choose an option to continue this session.');
    });
  }
  close() {
    for (const request of [...this.pending.values()]) request.finish(null, 'session ended');
  }
  decide({ requestId, optionId }) {
    const request = this.pending.get(requestId);
    if (!request || !request.view.options.some((o) => o.optionId === optionId))
      throw new Error('Permission request is stale or choice is invalid');
    request.finish(optionId, 'answered');
    return { accepted: true };
  }
}
module.exports = { AttentionSession };
