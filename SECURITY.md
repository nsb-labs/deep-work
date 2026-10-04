# Security and data handling

DeepWork is a local Windows desktop application using the user's classic Outlook profile. It makes no Graph calls and collects no mailbox credentials. Outlook may synchronize with its existing server during COM access. No email sending or mailbox deletion operation is implemented.

Workspaces contain private information: the database, task notes/history, email bodies, graph facts and excerpts, summaries, drafts, audit events, and generated Markdown. They are not encrypted by DeepWork. Use an organization-approved device, access controls, disk encryption, backup policy, and workspace location. A cloud-synced folder can upload local data independently of DeepWork.

The 1–15 day setting limits ingestion lookback. Retention is separate and does not erase all derived work: open-task and pending-review evidence, active-memory evidence, and unprocessed mail are pinned. Deactivating a fact removes it from retrieval, not audit history or secure storage. CLI providers may retain their own prompts/history outside the workspace. A device-only claim requires a validated local-model adapter, which is not included in this release.

The selected AI CLI may send supplied context to its model service. The user must confirm organization approval. CLI authentication, global configuration, hooks, agents, MCP servers, network access, and provider retention are external boundaries. The default generated Kiro agent has no tools; selecting a custom agent transfers its configuration responsibility to the organization. Codex is invoked with read-only sandboxing. DeepWork does not use blanket tool trust.

The renderer has no Node integration and runs with context isolation and sandboxing. IPC validates sender/main-frame identity and exposes named operations rather than arbitrary shell/filesystem commands. Providers receive prompts through stdin and commands through argument arrays without a shell. AI changes are schema-checked, source-linked, and revision-checked before persistence. These safeguards do not constitute a completed independent security audit.

Do not post private email, organization metadata, credentials, workspace databases, or unredacted CLI logs in public reports. Use a synthetic reproduction. Once a public repository exists, enable its private vulnerability-reporting channel before release. Until then, report suspected vulnerabilities directly to the maintainer through an existing private channel; this folder does not invent or configure a public reporting endpoint.

Release owners must check dependency advisories, Windows/WSL process cleanup, helper execution policy/integrity, packaged-file contents, and signing. Keep production-readiness claims separate from passing local development tests.
