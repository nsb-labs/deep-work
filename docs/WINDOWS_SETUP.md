# Windows setup and validation

## Requirements

- Windows with **classic Outlook** installed and a usable signed-in profile. New Outlook is not supported by this COM connector.
- Windows PowerShell with COM automation permitted by organization policy. The helper is run with `-NoProfile -NonInteractive -STA`; DeepWork does not bypass execution policy. Administrators may need to approve/sign the helper script.
- Node.js 22.14 or newer supported Node 22 release and npm for development.
- An approved, authenticated Kiro or Codex CLI for live inference. The synthetic demo requires neither.
- A writable dedicated workspace outside the source checkout, preferably outside automatic cloud-sync folders when local-only storage is required.

Outlook profiles, folders, protected messages, Object Model Guard, and cached bodies can differ by organization. This integration does not bypass those controls. Running a CLI on the same computer does not determine where its model processes prompts.

## Automatic CLI detection

Opening Settings automatically scans for Kiro CLI and Codex CLI. **Detect installed CLIs** rescans after installation. Detection checks native executables on PATH, user bin directories, and npm Codex vendor binaries (including nested platform packages), plus up to eight installed WSL distributions. Each result shows its path, version, and execution environment. Select **Use this CLI**, confirm organization approval, and save settings. Discovery does not send email, authenticate, install software, or replace saved configuration.

Nonstandard installation locations remain configurable using the executable field. Restart DeepWork after changing Windows PATH. WSL discovery may start an installed distribution; unresponsive distributions or failed version checks appear as diagnostic messages. Native discovery still works when WSL is unavailable.

The npm search follows the vendor layout in [Codex’s official launcher](https://github.com/openai/codex/blob/main/codex-cli/bin/codex.js).

## Native CLI configuration

Enter an actual executable path or a native executable discoverable through PATH. Paths with spaces are passed as arguments, without shell interpolation. `.cmd`, `.bat`, and `.ps1` CLI launchers are rejected. For an npm Codex installation, locate its native Windows `codex.exe` or use WSL; entering `codex.cmd` is not supported.

Authenticate using the CLI's own documented organization-approved method. Settings stores no tokens. **Check saved CLI configuration** runs `--version` and confirms discovery; actual jobs confirm authentication and result-format compatibility.

Kiro's adapter targets V3 headless mode. The generated `deepwork` agent has no tools, resources, or MCP servers and disables workspace MCP inclusion. A custom agent name selects the organization's existing configuration; its tools/hooks and global CLI settings remain the organization's responsibility. Kiro authentication requirements vary by release and account; follow [official headless documentation](https://kiro.dev/docs/cli/headless/). Codex uses its own saved authentication and read-only sandbox.

## WSL mode

Install and authenticate the selected CLI inside the intended WSL distribution. Configure its Linux executable name/path and optional distribution name. The Windows COM helper remains on the Windows host. The workspace must be on a Windows drive mapped by WSL, such as `C:\DeepWorkWorkspace` -> `/mnt/c/DeepWorkWorkspace`; UNC/network-only and Linux-only workspace paths are not supported by this mapping.

WSL must provide `/usr/bin/setsid`, `/bin/sh`, and `/bin/kill`. Each CLI job runs in its own Linux process group. Cancellation attempts group termination, then stops the Windows launcher. Actual cancellation, permissions, drive mount options, and paths with spaces must be tested on the organization's Windows/WSL image. Unconfirmed cleanup halts the queue until restart.

## Folder setup and scans

Empty folder configuration reads the profile's default Inbox and Sent Items. **Discover default folders** shows exact paths. To include project subfolders or another store, enter their complete Outlook paths, one per line. Default Sent folder IDs are used for sent-mail classification, independent of localization.

Recent received/sent/modified messages within the selected 1–15 day lookback are eligible. Open task conversations get separate older-thread queries in configured folders where Outlook supports them. The message limit is global across scan groups. Each scan rotates groups and resumes offsets, so repeated scans advance instead of always stopping at the same newest Inbox items. Incomplete scans and unreadable bodies are shown. Offset cursors are best effort; moved/reordered mail may need a complete wraparound rescan.

This is local-client extraction, not a claim of disconnected operation: Outlook may fetch data from its own mail server. DeepWork makes no Graph or direct mailbox-server requests.

## Validation commands

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run smoke:desktop
npm run verify:outlook
npm run dist
```

The Outlook check is explicitly live/read-only and writes its small output into a temporary directory, then removes it. It discovers folders and attempts a five-message scan, reports counts/warnings only, and does not display mail bodies, invoke AI, or send email.

Before claiming Windows support, validate:

- Demo startup, manual tasks, source reading, summaries/drafts, status changes, and restart persistence.
- Real Inbox and Sent Items, multiple stores, non-English folder names, non-US dates, messages with many recipients, empty bodies, large bodies, Outlook policy prompts, and unavailable cached messages.
- Small-limit pagination continuing through busy Inbox/Sent folders and older tracked conversations.
- Repeated scans without duplicate tasks, moved source items, missing/deleted source items, and tasks older than the lookback.
- Each approved CLI: version/authentication, actual event/result schema, Unicode replies, malformed output, network/service failure, timeout, cancellation with descendants, and restart during an active job.
- Native and WSL execution separately, including executable/workspace paths with spaces.
- Installer contents, utility-worker startup and sql.js WASM loading from packaged files, clean installation, upgrade data preservation, and uninstall behavior.

CI checks the engine/build and PowerShell syntax. It does not have an Outlook profile or AI credentials and cannot replace these live checks.

## Troubleshooting

**COM request failed:** confirm classic Outlook is installed and its profile opens normally. Check helper execution policy and organization restrictions. Narrow folder paths; protected or uncached bodies may remain unavailable.

**Scan incomplete:** sync again to continue the saved page, increase the limit, or narrow folders. Work already extracted is persisted. Do not interpret a capped scan as proof that a message was deleted.

**Unprocessed messages:** configure/approve the CLI, check Processing, and retry failures. VIP/manager messages remain visible independently of inference.

**Malformed Kiro output:** confirm a V3 CLI with stream-json and the selected agent is available. Do not enable blanket tool trust. Capture only a synthetic reproduction before opening a public issue.

**Workspace service failed:** preserve `deepwork.sqlite`. Check folder permissions and schema compatibility. Do not delete the database as a routine repair. Rebuild Markdown when only projections fail.

**Queue halted after cancellation:** cleanup could not be confirmed. Inspect the organization's native/WSL processes before restarting; report a synthetic reproduction and CLI version.

## Packaging

`npm run dist` creates Windows NSIS output under `release/` using an explicit code-file allowlist. The COM helper and icon are extra resources; sql.js WASM is unpacked. Dependencies and helper integrity must be reviewed before shipping. No workspace, credentials, Outlook cache, or private email should be included in release contents.

Installer creation/signing requires an actual Windows release validation run. Configure certificate secrets through the release environment; do not commit them. Public distribution additionally requires reviewing dependency advisories, confirming bundled asset rights, and enabling a private security-reporting channel.

## Context budget

Settings → Processing limits includes **Context token budget** (4,000–64,000; default 8,000 estimated input tokens). Processing shows the prepared request estimate and cleanup counts. This estimate is provider-independent; actual billed tokens depend on the model. Threads are processed in chronological batches. An individual email that cannot fit remains pending with a visible failure; raise the budget and retry. Originals remain in the local cache under the connector’s existing body-size limit.
