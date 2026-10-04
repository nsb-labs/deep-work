import { useEffect, useState } from 'react';
import type { CliDiscovery, Preferences } from '../lib/workTypes';
const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);

export function Settings({
  value,
  onSave,
  onOperation,
}: {
  value: Preferences;
  onSave: (p: Preferences) => Promise<void>;
  onOperation: (operation: string) => Promise<void>;
}) {
  const [p, setP] = useState(value);
  const [discovery, setDiscovery] = useState<CliDiscovery | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState('');
  const detect = async () => {
    setDetecting(true);
    setDetectionError('');
    try {
      setDiscovery(await window.workAPI.request<CliDiscovery>('discoverCli'));
    } catch (error) {
      setDetectionError(error instanceof Error ? error.message : 'CLI detection failed.');
    } finally {
      setDetecting(false);
    }
  };
  useEffect(() => {
    void detect();
  }, []);
  const [saving, setSaving] = useState(false);
  const [multiline, setMultiline] = useState({
    vipEmails: value.vipEmails.join('\n'),
    managerEmails: value.managerEmails.join('\n'),
    goals: value.goals.join('\n'),
    folders: value.folders.join('\n'),
  });
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setP((prev) => ({
      ...prev,
      [key]: value,
      ...(['provider', 'executable', 'execution', 'agent', 'wslDistribution'].includes(key)
        ? { organizationApproved: false }
        : {}),
    }));
  return (
    <form
      className="settings-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSave({
            ...p,
            vipEmails: lines(multiline.vipEmails),
            managerEmails: lines(multiline.managerEmails),
            goals: lines(multiline.goals),
            folders: lines(multiline.folders),
          });
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="settings-section">
        <h2>Outlook and priorities</h2>
        <label>
          Mail source
          <select
            value={p.mode}
            onChange={(e) => update('mode', e.target.value as Preferences['mode'])}
          >
            <option value="demo">Synthetic demo mail</option>
            <option value="outlook">Classic Outlook · Windows COM</option>
          </select>
        </label>
        <label>
          Email lookback · 1–15 days
          <input
            type="number"
            min={1}
            max={15}
            value={p.lookbackDays}
            onChange={(e) => update('lookbackDays', Number(e.target.value))}
          />
        </label>
        <label>
          Manager email addresses · one per line
          <textarea
            value={multiline.managerEmails}
            onChange={(e) => setMultiline((prev) => ({ ...prev, managerEmails: e.target.value }))}
          />
        </label>
        <label>
          VIP email addresses · one per line
          <textarea
            value={multiline.vipEmails}
            onChange={(e) => setMultiline((prev) => ({ ...prev, vipEmails: e.target.value }))}
          />
        </label>
        <label>
          Goals · one per line
          <textarea
            value={multiline.goals}
            onChange={(e) => setMultiline((prev) => ({ ...prev, goals: e.target.value }))}
          />
        </label>
        <label>
          Outlook folder paths · one per line
          <textarea
            placeholder={
              'Leave blank for default Inbox and Sent Items\n\\\\Mailbox\\Inbox\\Project'
            }
            value={multiline.folders}
            onChange={(e) => setMultiline((prev) => ({ ...prev, folders: e.target.value }))}
          />
        </label>
        <p className="muted">
          Folder discovery uses saved settings. Save before testing. Mail is scanned only when you
          select Sync mail.
        </p>
        <button type="button" onClick={() => onOperation('folders')}>
          Discover default folders
        </button>
      </div>
      <div className="settings-section">
        <h2>AI CLI</h2>
        <button type="button" disabled={detecting} onClick={() => void detect()}>
          {detecting ? 'Detecting installed CLIs…' : 'Detect installed CLIs'}
        </button>
        <div aria-live="polite">
          {detectionError && <p className="job-error">{detectionError}</p>}
          {discovery && !detecting && (
            <>
              {!discovery.installations.length && (
                <p>No supported CLI detected. You can enter its path below.</p>
              )}
              {discovery.installations.map((cli) => (
                <div
                  className="artifact"
                  key={`${cli.execution}:${cli.wslDistribution}:${cli.executable}`}
                >
                  <h3>
                    {cli.provider === 'codex' ? 'Codex CLI' : 'Kiro CLI'} ·{' '}
                    {cli.execution === 'wsl' ? `WSL · ${cli.wslDistribution}` : 'Native'}
                  </h3>
                  <p className="meta">{cli.version}</p>
                  <p className="meta">{cli.executable}</p>
                  <button
                    type="button"
                    onClick={() =>
                      setP((prev) => ({
                        ...prev,
                        provider: cli.provider,
                        executable: cli.executable,
                        execution: cli.execution,
                        wslDistribution: cli.wslDistribution,
                        organizationApproved: false,
                      }))
                    }
                  >
                    Use this CLI
                  </button>
                </div>
              ))}
              {discovery.diagnostics.map((note) => (
                <p className="muted" key={note}>
                  {note}
                </p>
              ))}
              <p className="muted">{discovery.note}</p>
            </>
          )}
        </div>
        <label>
          Default provider
          <select
            value={p.provider}
            onChange={(e) => update('provider', e.target.value as Preferences['provider'])}
          >
            <option value="demo">Demo · no AI service</option>
            <option value="kiro">Kiro CLI</option>
            <option value="codex">Codex CLI</option>
          </select>
        </label>
        <label>
          CLI executable
          <input
            placeholder="kiro-cli.exe or full native codex.exe path"
            value={p.executable}
            onChange={(e) => update('executable', e.target.value)}
          />
        </label>
        <label>
          Execution
          <select
            value={p.execution}
            onChange={(e) => update('execution', e.target.value as Preferences['execution'])}
          >
            <option value="native">Native Windows executable</option>
            <option value="wsl">WSL executable</option>
          </select>
        </label>
        {p.execution === 'wsl' && (
          <label>
            WSL distribution · optional
            <input
              value={p.wslDistribution}
              onChange={(e) => update('wslDistribution', e.target.value)}
            />
          </label>
        )}
        {p.provider === 'kiro' && (
          <label>
            Kiro agent · optional
            <input value={p.agent} onChange={(e) => update('agent', e.target.value)} />
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={p.organizationApproved}
            onChange={(e) => update('organizationApproved', e.target.checked)}
          />
          This CLI and its model service are approved for my organization’s email.
        </label>
        <p className="muted">
          DeepWork stores work locally. A CLI may send context to its model service and keep its own
          history. Authenticate and configure its tools outside DeepWork.
        </p>
        <button type="button" onClick={() => onOperation('probe')}>
          Check saved CLI configuration
        </button>
        <h2>Processing limits</h2>
        <label>
          Context token budget · estimated per request
          <input
            type="number"
            min={4000}
            max={64000}
            value={p.contextTokenBudget}
            onChange={(e) => update('contextTokenBudget', Number(e.target.value))}
          />
        </label>
        <p className="muted">
          Default 8,000 estimated input tokens. Includes a reserve for instructions. Large threads
          are processed in batches; oversized individual emails stay pending until you increase the
          budget. Actual token usage depends on the CLI’s model.
        </p>
        <label>
          Job timeout · seconds
          <input
            type="number"
            min={10}
            max={600}
            value={p.timeoutSeconds}
            onChange={(e) => update('timeoutSeconds', Number(e.target.value))}
          />
        </label>
        <label>
          Maximum messages per scan
          <input
            type="number"
            min={1}
            max={5000}
            value={p.maxMessages}
            onChange={(e) => update('maxMessages', Number(e.target.value))}
          />
        </label>
        <label>
          Source retention · days
          <input
            type="number"
            min={15}
            max={3650}
            value={p.retentionDays}
            onChange={(e) => update('retentionDays', Number(e.target.value))}
          />
        </label>
        <p className="muted">
          Open task evidence, active memory evidence, and unprocessed messages are retained beyond
          this limit.
        </p>
        <button className="primary" disabled={saving} type="submit">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
