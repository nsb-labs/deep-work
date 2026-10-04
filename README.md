# DeepWork

DeepWork turns Outlook email into a persistent work dashboard. It keeps VIP and manager messages visible, tracks actions and people you are waiting on, connects work to your goals, and creates summaries and reply drafts using relevant past context. Tasks can also come from conversations outside email.

**Current target: Windows with classic Outlook.** This is an initial implementation for development and contributions, with a working synthetic demo. Live COM ingestion, organization CLI authentication, WSL process cleanup, and Windows installers need validation on real Windows systems before a production release. New Outlook and macOS mailbox ingestion are outside this release.

## Start with the demo

Use Node.js 22.14 or newer supported Node 22 release and npm. The demo needs no Outlook account, Python backend, or AI credentials.

```sh
npm ci
npm run dev
```

Select **Sync mail** to load three synthetic messages and generate tasks and memory. Add a manual task, select it, and try **Summarize** or **Draft reply**. The demo provider is deterministic and is clearly labeled; it is not AI inference.

The default workspace is under Electron's per-user application data directory. Choose a dedicated folder using **Choose folder**; switching restarts the app and requires finished/cancelled jobs. For development you can set `DEEPWORK_WORKSPACE` to an absolute folder path. The SQLite database is authoritative. Markdown files are generated for reading and reference; editing them does not change tasks.

## Connect classic Outlook on Windows

1. Open classic Outlook and ensure the intended profile and folders are available. New Outlook does not provide this COM integration.
2. In **Settings**, select **Classic Outlook · Windows COM**. Configure an email lookback from 1 to 15 days, VIP/manager addresses, goals, and optional folder paths. Empty folder selection uses the default Inbox and Sent Items.
3. Choose Kiro or Codex, configure its executable and native/WSL mode, and authenticate the CLI separately. Confirm that the CLI and its model service are approved for your organization's email. See [Windows setup](docs/WINDOWS_SETUP.md).
4. Save settings and check the CLI. Discover default folders if needed. Select **Sync mail**. If a scan reports incomplete pages, sync again to continue. **Processing** shows failures and retry/cancel controls.
5. Review proposed changes in **Review updates**. Read email sources before accepting uncertain matches or completion. Summaries and reply drafts are saved locally; this release does not send messages.

DeepWork reads through the existing Outlook client/profile. It does not use Graph or collect mailbox passwords. Outlook itself may synchronize with its server when COM properties are accessed. DeepWork's local storage does not make a cloud-backed CLI device-only: prompts and CLI history follow that provider's configuration.

## Development checks

```sh
npm run typecheck
npm test
npm run build
npm run smoke:desktop
```

`smoke:desktop` launches the built Electron app with an isolated temporary demo workspace, verifies service/preload/UI wiring, and exercises a reply draft. Run `build` first. Windows users can run `npm run verify:outlook` for an explicit read-only COM check that discovers default folders and extracts a small page into a temporary workspace. That command does not send email or invoke AI.

`npm run dist` builds the Windows NSIS installer. Run it on Windows with the release prerequisites in [Windows setup](docs/WINDOWS_SETUP.md). Signing is a release-owner responsibility; no signing credentials are included.

## Understand and contribute

- [Architecture and source map](docs/ARCHITECTURE.md): components, sequence diagrams, data ownership, and extension seams.
- [Product intent](docs/PRODUCT_ARCHITECTURE.md): requirements and design rationale.
- [Integration contracts](docs/INTEGRATION_CONTRACTS.md): mailbox and AI job formats.
- [Windows setup and validation](docs/WINDOWS_SETUP.md): classic Outlook, executable paths, WSL, troubleshooting, and release checks.
- [Contributing](CONTRIBUTING.md): development workflow and test expectations.
- [Security and data handling](SECURITY.md): local storage, provider boundaries, and reporting guidance.

The service is plain CommonJS JavaScript so it runs directly in Electron's utility process and Node's test runner. UI and Electron boundary code use TypeScript. No external email-agent Python scripts or interactive terminal prompts are required by the active application.

MIT license; see [LICENSE](LICENSE). Asset provenance and the private vulnerability-reporting channel must be confirmed before a public release.

Switch between light and dark using the theme button in the top bar. Your choice is saved locally per workspace and restored when DeepWork opens.

Select a task to open its chat. Ask questions, request a summary, or draft a reply with the task, linked emails, and relevant memory as context. Responses stream from the selected CLI, and conversations are saved locally with Markdown exports. Use **Stop response** to cancel a turn.

Email processing groups pending messages by conversation, removes verified repeated quotes and recognizable contact signatures locally, and sends compact relevant context. Settings includes an estimated input-token budget (default 8,000). Large threads continue in batches; original cached emails remain available. Processing shows request estimates. In task chat, expand Context to include a specific older email.

Kiro jobs use ACP for streaming and same-session permission handling. Use **Open Kiro console** at the bottom at any time to view session output. When Kiro requests approval, the collapsible bottom console opens with the requested action and one-time choices. Stop cancels the session; unanswered requests expire after five minutes. Background failures preserve pending mail for explicit retry. The console handles structured approvals, not arbitrary terminal prompts; complete Kiro login in your selected native/WSL environment when needed. See [integration contracts](docs/INTEGRATION_CONTRACTS.md) for compatibility and organization-agent details.
