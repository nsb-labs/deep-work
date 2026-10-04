# Validation record

Initial Windows-first implementation, 2026-10-03. Local host: macOS, Node 22.14.0. Synthetic workspaces only; no real email or model credentials were used.

## Completed here

- TypeScript checks for renderer and Electron main/preload; Vite production builds.
- Node behavioral suite: 54 passing tests, one Windows-only PowerShell parser check skipped on this host. Coverage includes persistence/reopen, duplicate and moved mail, VIP visibility despite inference failure, reviewed status reconciliation, stale task revisions, invalid evidence/goals, drafts excluded from memory, old open tasks, manual tasks, cancellation/retry, restart recovery, provider switching, disk-save rollback, source-version supersession, projection retention, pending-review evidence, revised deadlines, manual detail edits, unchanged-proposal suppression, Unicode process output, and worker RPC.
- Actual Electron desktop smoke with the sandboxed preload and utility process: synthetic sync produced three tasks; the renderer displayed them; a task opened; a draft job completed and rendered. The test uses a disposable workspace and does not contact Outlook or an AI model.
- Implementation/spec reviews identified issues in persistence rollback, scan starvation, retention copies, source supersession, waiting-on ownership, correction audit, Unicode output, and process cleanup. Changes and behavioral tests address the platform-independent cases. Windows-specific changes still need live verification.

CLI discovery adds behavioral checks for native paths with spaces, both npm vendor layouts, duplicate suppression, shell-launcher exclusion, WSL distribution/path arguments, unavailable WSL, failed version checks, and UTF-16 output with non-ASCII distribution names. Actual Windows installation discovery remains pending live verification.

## Pending Windows evidence

PowerShell parsing, classic Outlook profile/folder access and COM cleanup, locale-specific date filters, localized Sent Items, large recipient lists, scan-group pagination and mailbox reordering, tracked conversation retrieval, native Kiro/Codex authentication and actual result/event formats, WSL process-group cancellation, and installer contents/runtime behavior. See [Windows setup](WINDOWS_SETUP.md). CI is supplied but has not been run remotely in this folder.

## Dependencies

The dependency audit led to removal of the unused terminal/native-PTY and Tailwind stack and updates to Electron, Vite, and electron-builder. The latest full audit still reports eight high-severity dependency entries rooted in the build-time electron-builder chain: `@electron/get@3.1.0 -> got@11.8.6 -> cacheable-request@7.0.4 -> http-cache-semantics@4.2.0`. These are entries in one affected chain, not eight demonstrated application exploits. No applicability/exploit assessment of the packaging workflow was performed.

The upstream [http-cache-semantics advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) lists no patched version at the time of this check. Do not apply an unverified forced downgrade or claim a clean dependency audit. Recheck the chain and packaging usage before public release. The application uses no shared HTTP cache from that chain for email or task processing, but its presence in build tooling remains a release-review item.

## Repository and release

Git is initialized with [nsb-labs/deep-work](https://github.com/nsb-labs/deep-work) as origin. The first implementation commit preserves the remote’s initial commit and MIT license. No installer release, code signing, or installer publication was performed. README, architecture/contracts/setup documentation, contributor guidance, and Windows/Linux CI accompany the source. Existing icon/source rights and a private security-reporting channel still need maintainer confirmation before an installer release.

## Task chat validation

Added checks for streamed partial answers before job completion, task/source/memory context, task isolation, conversation persistence and Markdown export, cancelled/failed turns, interrupted restart recovery, approval checks, Unicode stream framing, Codex handshake/deltas/final reconciliation, rejected interactive requests, Kiro delta/final reconciliation, and a real duplex subprocess fixture. Desktop smoke verifies selecting a task opens chat, multiple partial events reach the renderer, and the completed conversation is saved. Codex’s installed CLI generated its protocol schema locally and passed real app-server initialization plus EOF shutdown without starting a model turn; live model streaming and Windows/WSL behavior require verification with approved accounts.

## Email context efficiency

Behavioral checks cover verified quoted-suffix cleanup, preservation of uncertain inline replies and action-bearing footers, grouped thread processing, SentOn ordering, batch continuation without marking unseen sources processed, oversized-message failures, metadata-only change suppression and legacy version preservation, compact provider projection, stale-source rollback, explicit older-email chat context, and preservation of original cached bodies. Live Outlook SentOn extraction and localized formatting still need Windows verification. Token estimates are heuristic; no model-account token-cost benchmark was run.

## Kiro attention flow

`tests/attention.test.mjs` covers scoped single-use choices, cancellation, expiry, restart invalidation, pending-mail preservation, continued sync during approval and a real synthetic duplex ACP subprocess that waits longer than its execution timeout for a user decision. `npm run smoke:attention` exercises actual Electron main/preload/worker/renderer wiring with a synthetic executable on a POSIX development host, including automatic panel expansion, hiding without cancellation, denial/resume and stale decision rejection. It contacts no model or mailbox. This fixture does not establish Windows/Kiro compatibility.

Before rollout, validate native/WSL Kiro ACP v1 handshake, organization-agent selection, `agent_message_chunk` streaming, permission requests (approve and deny), stop/expiry process cleanup and login-required retry on the installed version. Arbitrary terminal/TUI prompts are not supported by the structured console; authentication is completed separately in the selected CLI environment.

Recorded on 2026-10-04: 63 tests passed, one Windows-only test skipped; typecheck/build and formatting passed. Both desktop smoke tests passed on the macOS development host. The existing smoke initially returned Electron's `UnknownVizError` and passed on retry; the approval smoke passed before and after the final V3 launch update. Installed Codex accepted the explicit `--ask-for-approval never exec --help` option check without running a model. Kiro was not installed on this host, so no live Kiro/model/Windows approval claim is made.
