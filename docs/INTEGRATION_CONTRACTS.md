# Integration contracts

The authoritative runtime validator is `service/core/contracts.cjs`. Renderer shapes live in `src/lib/workTypes.ts`. Provider additions must reuse those validators rather than defining another task writer.

## Application operations

`window.workAPI.request(operation, value)` returns a promise. Electron's main process validates sender/main-frame identity, operation allowlist, and payload size, then assigns an RPC request ID. The worker responds with `{id,result}` or `{id,error}`. Internal service dispatch also supports shutdown; that operation is not exposed to the renderer.

| Operation             | Input                                                        | Result                                                                                                                       |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`            | none                                                         | Preferences, tasks, message metadata, facts, pending suggestions, jobs, last scan                                            |
| `settings`            | Complete preferences object                                  | Saved validated preferences                                                                                                  |
| `theme`               | `"dark"` or `"light"`                                        | Saved appearance preference; other settings preserved                                                                        |
| `addTask`             | `{title,notes?,owner?,goal?,waitingOn?}`                     | New user task                                                                                                                |
| `editTask`            | `{taskId,revision,title,notes,owner,waitingOn,goal,dueDate}` | Updated task details or stale-revision error                                                                                 |
| `status`              | `{taskId,revision,status}`                                   | Updated task or stale-revision error                                                                                         |
| `readTask`            | Task ID                                                      | Task, related source bodies, recent artifacts                                                                                |
| `readMessage`         | Message ID                                                   | Cached source body and metadata                                                                                              |
| `sync`                | none                                                         | Queued sync job ID                                                                                                           |
| `processPending`      | none                                                         | Classification job IDs                                                                                                       |
| `summarize` / `draft` | `{taskId,userContext?}`                                      | Queued job ID                                                                                                                |
| `chat`                | `{ taskId, userContext, sourceId? }`                         | Queued chat job ID; task detail includes conversation and related memory                                                     |
| `suggestion`          | `{id,accept}`                                                | Reviewed change or stale-evidence error                                                                                      |
| `fact`                | `{id,subject,relation,object}` or `{id,active:false}`        | Correction/deactivation                                                                                                      |
| `cancel` / `retry`    | Job ID                                                       | Cancellation or replacement job ID                                                                                           |
| `openSource`          | Message ID                                                   | Opens existing item in classic Outlook                                                                                       |
| `folders`             | none                                                         | Default folder paths/profile name                                                                                            |
| `discoverCli`         | none                                                         | `{ installations, diagnostics, note }`; each installation includes provider, executable, execution, wslDistribution, version |
| `probe`               | none                                                         | CLI version and readiness note                                                                                               |
| `export`              | none                                                         | Rebuild projections and report export error                                                                                  |

Workspace selection is a separate main-process operation using a native directory picker. The renderer cannot supply a path to run a process or read arbitrary files.

## Normalized email

A connector returns a complete bounded batch, warnings, folder paths, and optional cursor. Normalization happens before database mutation so malformed mail cannot create a half-ingested batch. Bodies are plain text and limited to 100,000 characters. Recipient arrays are bounded to 500 individual entries; Outlook resolves SMTP addresses where available and falls back to an individual recipient address.

```json
{
  "account": "opaque-store-id",
  "storeId": "opaque-store-id",
  "providerId": "outlook-entry-id",
  "internetId": "<message@example.test>",
  "threadId": "outlook-conversation-id",
  "folder": "\\\\Example mailbox\\Inbox",
  "subject": "Launch readiness",
  "sender": "manager@example.test",
  "recipients": ["me@example.test"],
  "body": "Please prepare the readiness update.",
  "receivedAt": "2026-10-03T12:00:00.000Z",
  "modifiedAt": "2026-10-03T12:00:00.000Z",
  "isSent": false
}
```

The engine generates `id` from account and Internet Message-ID (fallback provider ID), and `version` from relevant content and modification time. Those generated IDs are what providers cite. Moves can change provider IDs; a stable Internet Message-ID preserves task links within the same account. Cross-store moves and messages missing stable IDs need further identity reconciliation; do not pretend subject matching solves this.

The PowerShell request file supports only `folders`, `sync`, and `open`. Sync requests include validated lookback/limits, configured folder paths, tracked conversation IDs, and previous cursors. The response is a UTF-8 JSON file with `ok`, `messages`, `warnings`, `folders`, and next cursor. Per-folder/thread groups rotate under the global limit and resume with overlapping offsets. Runtime failure returns a non-sensitive actionable error. The adapter cleans temporary request/response files.

## AI request

The engine supplies operation, frozen job settings, selected task (when applicable), candidate tasks, thread messages, retrieved memory, and optional user reply context. Sources retain generated ID/version; tasks retain ID/revision. Credentials are inherited from the user's CLI environment/configuration, not placed in preferences or prompts by DeepWork.

## AI response

A provider returns one object. Empty strings represent unknown optional scalar fields. `taskId: ""` proposes a new task. Existing IDs must appear in supplied candidate tasks. Evidence IDs must appear in supplied messages, and goals must be explicitly configured.

```json
{
  "text": "",
  "changes": [
    {
      "taskId": "",
      "title": "Prepare launch readiness update",
      "status": "open",
      "owner": "Me",
      "waitingOn": "",
      "dueDate": "",
      "goal": "",
      "evidenceIds": ["generated-message-id"],
      "confidence": 0.9,
      "reason": "The manager explicitly requested this update."
    }
  ],
  "facts": [
    {
      "subject": "manager@example.test",
      "relation": "requested",
      "object": "launch readiness update",
      "evidenceId": "generated-message-id",
      "quote": "Please prepare the readiness update.",
      "confidence": 0.9
    }
  ]
}
```

Supported statuses: `open`, `in_progress`, `waiting_on`, `done`, `dismissed`. Summaries and drafts must return `changes: []`. Drafts must additionally return `facts: []`; their proposed language is never treated as delivered commitments. Facts require exact excerpts from supplied email bodies. Structurally valid extraction is not a truth guarantee; the memory UI supports review/correction.

Validation runs before the transaction. The transaction rechecks source versions and task revisions. It then applies new-task rules, saves review proposals, facts, artifacts, processing markers, job success, and audit events together. An invalid result is a failed job and its source remains pending.

## Provider adapters

Codex uses noninteractive `exec`, read-only sandbox, a supplied JSON Schema, and a last-message JSON artifact. Prompt data is piped through stdin. Select a native `codex.exe` binary rather than an npm `.cmd` launcher, or use WSL. Shell-script executables are intentionally rejected.

Kiro uses `kiro-cli acp --agent-engine=v3 --auth-method=cli` with the selected agent supplied as `_meta.kiro.modeId` on `session/new` and verified from returned modes, with JSON-RPC over stdin/stdout for both structured processing and task chat. DeepWork supplies a local no-tools agent unless the user selects an organization-managed agent. Initialize with ACP version 1, create a fresh session, send bounded context through `session/prompt`, stream `agent_message_chunk` updates, and require `end_turn`. Structured processing parses exactly one JSON result from the final message (using messageId when supplied, otherwise the segment after the last tool/permission boundary); earlier commentary remains console output. Tool details are merged by toolCallId before requesting a decision. Requests without a human-readable action title cannot offer approval. Unsupported versions or event shapes fail visibly; no fallback parses terminal prompts.

`session/request_permission` pauses the affected job as `awaiting_approval`. The bottom Kiro console automatically expands and renders tool details and the provider's `allow_once` / `reject_once` options. It returns the selected opaque option ID to the original RPC request in the same session. Persistent trust options are excluded. Unknown filesystem/terminal RPCs are rejected, and DeepWork advertises no client tool capabilities. Organization-managed agents may still have tools/hooks already authorized by their own configuration; this interface does not override that configuration.

Approvals expire after five minutes. The process execution timeout pauses during a permission wait and resumes afterward. Stop, timeout and provider exit clear callbacks; interrupted approval jobs become failed on restart. Decisions are bound to a random local request ID and job ID, are single-use, and record only decision metadata in the local audit records. Tool input/transcripts stay in bounded in-memory buffers, not Markdown or process logs. Permission details are rendered as plain text. A real email/CLI response never constitutes approval.

Kiro failures are `needs_attention` and retain pending email; explicit Retry starts a new job using current settings. Dismiss notice hides the banner but preserves the job history. Authentication is not tool approval: login must be completed in the configured native/WSL environment before retry. The console is a structured session interface, not a raw PTY/shell, and cannot answer arbitrary legacy TUI prompts. Live authentication, permissions and event shapes must be checked against the organization's installed Kiro version before rollout.

The common process runner limits output, decodes UTF-8 after buffering, times out, and cancels process trees. In WSL it uses a dedicated Linux process group. Version probing confirms executable discovery only; it does not prove authentication or model access. Never use blanket tool trust to solve output-format or authentication failures.

Official provider references: [Kiro V3 ACP](https://kiro.dev/docs/cli/v3/acp-migration/), [ACP permissions](https://agentclientprotocol.com/protocol/v1/tool-calls), [Kiro agent configuration](https://kiro.dev/docs/custom-agents/configuration-reference/), [Codex noninteractive execution](https://developers.openai.com/codex/noninteractive/).

## Chat event channel

The preload exposes `onChatEvent(listener)` and returns an unsubscribe function. Events contain `{ taskId, jobId, text, status, error? }`; `text` is the full answer so far, not a delta to append. Filter by task ID. `readTask` supplies persisted conversation plus any current in-memory partial answer. Chat uses the existing job queue, `cancel`, and `retry`. Failed/cancelled turns are excluded from later model context.

## Prepared provider context

`buildInput` prepares compact, budgeted message/task records. `providerPayload` sends operation, configured goals, selected task/candidate task summaries, prepared sources, up to five memory facts, newMessageIds, bounded conversation, user context, and omission/budget metadata. Full preferences and local COM identifiers are not serialized into model prompts. Classified source IDs are tracked separately from older background sources; only the classified batch is marked processed. Processing job snapshots may include `contextStats` with estimatedTokens, budget, messageCount, pendingMessageCount, and removedCharacters.
