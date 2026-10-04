# DeepWork product architecture

Product requirements and design rationale based on intent described on 2026-10-03. The initial Windows implementation now exists; [ARCHITECTURE.md](ARCHITECTURE.md) is the authoritative map of implemented behavior and limitations. Real Outlook/CLI/installer validation is still pending.

## Product outcome

DeepWork is a local desktop work assistant for Windows using classic Outlook. macOS is deferred from the current scope. It helps people keep track of VIP and manager email, work connected to their goals, required actions, and commitments they are waiting on. People can add tasks from conversations outside email. Each task supports reading its source, summarizing, and drafting a reply using relevant past context.

Users configure VIPs, managers, goals, mailbox folders, a default AI CLI, and an email lookback of 1–15 days. The initial default is one day. Each ingestion run processes new or changed messages, reconciles existing work, and produces readable Markdown. Tasks and useful memory persist beyond the ingestion lookback.

## Architecture boundaries

```text
Electron / React desktop UI
           |
Validated application operations
           |
Work engine --- SQLite + local Markdown projections
    |                   |
Email connectors     Retrieval + evidence-backed knowledge graph
    |                   |
Windows Outlook COM  AI job runner
                         |
                  Kiro / Codex / demo (future CLI extensions)
```

The desktop renderer receives named operations such as syncMail, addTask, summarizeTask, and draftReply. It does not choose arbitrary scripts, shell commands, or filesystem paths. A background service in a separate process owns sync, jobs, persistence, and provider execution, so work survives window navigation and renderer reloads.

## Email connectors

Define one connector contract with account discovery, capability reporting, incremental message retrieval, source opening, and optional draft creation. All connectors normalize messages into the same internal format. Capabilities distinguish reading, historical thread retrieval, draft creation, and sending; unsupported operations are visible in the UI.

| Connector          | Intended use                                          | Constraints                                                        |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Outlook COM bridge | Classic Outlook on Windows using its existing profile | Primary live-ingestion connector; requires classic Outlook         |
| Local file import  | Demo and explicitly exported email                    | No continuous mailbox sync; imported formats need a defined parser |

COM is the live Outlook integration for the Windows release. Keep it behind the connector contract so task processing and memory remain independent of mailbox extraction. Setup must identify classic Outlook and its profile; new Outlook is outside this release’s supported client scope. macOS integration and Outlook web add-ins are deferred.

Run COM automation in a dedicated Windows helper process under the signed-in user, with serialized operations on an STA thread and explicit COM cleanup. Return normalized data through a validated IPC protocol. Reuse the existing Outlook profile without asking DeepWork to store mailbox credentials. Support bounded folder scans and reconciliation rather than assuming a mailbox delta API. Outlook policy prompts, missing cached bodies, unavailable profiles, and disconnected folders must surface as actionable errors. Local extraction covers data available through the Outlook client; it must not imply that Outlook itself will never contact its mail server.

Store connector-specific IDs and a normalized identity containing account, folder/source, provider ID, Internet Message-ID when available, thread identity, and content version/hash. Do not deduplicate by subject alone. Keep connector checkpoints per account and folder. Recover invalid checkpoints with a bounded local rescan. Track deletes and moves without deleting existing tasks or their historical provenance.

## Work engine and task lifecycle

SQLite is the transactional source of truth. Markdown is a readable projection with stable IDs and revision metadata; uncontrolled changes require an explicit import/reconciliation path. The AI returns a proposed structured change set. The engine validates and applies it, then generates Markdown atomically. AI output must not rewrite the whole dashboard directly.

Task fields include ID, title, owner, separate waiting-on person, status, due date, goal links, priority reasons, email/thread links, provenance, revision, and status history. Distinguish the message sender, action owner, and person the user is waiting on. Track states such as open, in_progress, waiting_on, done, and dismissed, with completion evidence and user overrides.

Manual tasks are first-class tasks with user provenance; email matching may suggest linking them, but must not silently merge unrelated work. One thread can contain several tasks, and one task can involve several threads. Match updates using explicit source links, existing task identifiers, and contextual evidence. Ambiguous matches become reviewable suggestions. Reprocessing the same message version must not create duplicate tasks or graph facts.

Configured VIPs and managers receive deterministic visibility before AI classification. AI enriches goal links, actions, dates, dependencies, and suggested status changes. The UI reports which messages have not yet been processed so model failures cannot silently hide important mail.

A 15-day lookback limits new ingestion, not task lifetime or all memory. Retain open tasks and their supporting evidence beyond the window. Check tracked conversations for subsequent updates; optionally retrieve older thread context within connector capabilities and user policy. Include sent mail where permitted so the engine can detect the user's commitments and replies.

## AI provider contract

Implement Kiro and Codex provider adapters; reserve a future extension seam for other approved CLI adapters. Each adapter handles discovery, version/capability checks, authentication readiness, executable location, invocation arguments, structured result parsing, cancellation, errors, and timeouts. Verify actual CLI behavior during implementation rather than assuming common flags or native Windows availability.

A shared job request contains operation, relevant source messages, matching tasks, retrieved memory, output schema, and policy. A provider result includes proposed task changes, summary or draft text, candidate memory facts, and evidence references. If structured output is not native, validate a constrained output artifact; malformed output is a failed job and does not mutate state.

Use a durable job queue with separate outputs per job, bounded concurrency, checkpoints, and retry classification. Recheck source and task revisions before committing to avoid overwriting a user's edit. Keep the embedded terminal as an optional interactive surface; terminal text scraping is not the workflow's persistence protocol.

Switching the default CLI must preserve tasks, memory, and preferences. Provider-specific prompts/configuration are generated from common instructions rather than becoming the only copy of product logic.

## Memory and knowledge graph

Start with graph nodes and edges in SQLite plus bounded term-based retrieval. No separate graph server or vector database is required for the first release. Nodes include people, projects, goals, decisions, commitments, and topics. Edges include manages, owns, relates_to, depends_on, and waiting_on.

Every fact has evidence, source date, confidence, provenance, and validity/supersession information. Keep an audit trail when correcting a fact. Retrieve task-linked facts first, then relevant people/projects, prior decisions, and applicable user preferences; bound the context passed to a CLI.

Email evidence can support memory facts. A summary is derived material, not independent evidence. An unsent draft is a proposal, not a promise or a completed action. User-confirmed corrections and explicitly saved preferences can become durable memory. A future sending integration may add sent commitments only with confirmed delivery; the current application does not send email. Do not strengthen a fact merely because the AI repeats it.

The system improves through retained context and corrections; this design does not imply model training.

## Storage and Markdown contract

```text
<selected-workspace>/
  deepwork.sqlite
  preferences.json
  memory/
    briefs/latest.md
    tasks/<task-id>.md
    threads/<thread-id>.md
    graph/index.md
    graph/nodes/<entity-hash>.md
    weekly-achievements/current.md
  drafts/<draft-id>.md
  summaries/<summary-id>.md
```

Store source bodies locally according to an explicit retention setting. Export task status, evidence links, latest relevant updates, and memory facts into Markdown. Preserve task IDs across exports. Keep secrets in platform credential storage, not these files. Store job metadata and sync checkpoints transactionally; avoid raw private email bodies in diagnostic logs.

## Local data and organization policy

The product can keep its database, memory, and drafts on the user's machine without a DeepWork-hosted backend. That does not guarantee all processing is local: the selected CLI may send prompts to a model service. Record the approved provider and processing mode, and explain it during setup. Strict device-only processing requires a validated local-model provider. The user requires local Outlook extraction only; Microsoft Graph and direct mailbox-server access are outside the selected scope.

Treat messages and attachments as untrusted content, not executable instructions. Use constrained provider permissions and validated changes. Default to read and draft workflows. Sending, deleting mailbox items, or modifying recipients requires an explicit user action and connector support. A drafted response must never automatically mark work complete.

## Processing flow

1. Read configured mailbox folders and sync checkpoints; retrieve eligible changes in the selected 1–15 day window and relevant tracked-thread updates.
2. Normalize messages, persist source versions, and surface VIP/manager items immediately.
3. Retrieve candidate existing tasks and relevant graph evidence.
4. Run the selected CLI to propose classifications, task changes, and supported memory facts.
5. Validate IDs, evidence, schema, and current revisions; apply accepted changes transactionally and flag uncertain changes for review.
6. Generate Markdown and refresh the dashboard; record per-message success/failure and update checkpoints without losing failed work.
7. For reading, summarizing, or drafting, retrieve task-specific context and create a separate result artifact. Apply memory updates only under the provenance rules above.

## Delivery sequence

1. Establish the shared engine with synthetic mail, manual tasks, SQLite, Markdown export, preferences, and a provider contract. Keep the current dashboard as the initial UI.
2. Validate Kiro and Codex adapters on Windows, including native versus WSL execution where required, workspace path translation, queueing, cancellation, and failed/malformed results. The COM helper remains on the Windows host even if an AI CLI runs in WSL.
3. Implement classic Windows Outlook ingestion through a COM helper. Validate duplicate prevention, status reconciliation, source opening, and retention beyond the lookback.
4. Add evidence-backed graph retrieval, contextual replies, corrections, and weekly goal reports.
5. Validate Windows packaging, native dependencies, Outlook integration, and provider execution, then pilot with real organizations.

Important verification cases: repeated ingestion; moved/deleted messages; two tasks in one thread; overlapping tasks across threads; manual task linking; user-edited status during a running job; old open tasks after the lookback; failed CLI results; draft content excluded from factual memory; and switching providers without losing state.

The active application now uses the local service and normalized connector/provider contracts. External Python email scripts and the interactive PTY workflow have been removed from the active application. See the implementation architecture for the source map and validation limits.

## Platform references

- Microsoft, Outlook add-ins overview: https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview
- Microsoft, COM add-in compatibility and platform limits: https://learn.microsoft.com/en-us/office/dev/add-ins/develop/make-office-add-in-compatible-with-existing-com-add-in
- Microsoft, Outlook automation: https://learn.microsoft.com/en-us/office/vba/outlook/concepts/getting-started/automating-outlook-from-a-visual-basic-application

## Confirmed local-only requirement

The user selected access only to Outlook data already on the computer. Do not add Microsoft Graph authentication or mailbox-server access as a fallback. The current release targets Windows with classic Outlook only. macOS and new Outlook are deferred. The connector and AI provider boundaries remain modular for future expansion, but neither deferred client is part of current implementation or release validation.

Local storage and local extraction do not override the selected CLI’s processing behavior. Organization-approved remote inference is distinct from a strictly device-only model.
