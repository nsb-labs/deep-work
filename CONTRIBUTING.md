# Contributing to DeepWork

Start with [README.md](README.md), then read [the architecture](docs/ARCHITECTURE.md) and [integration contracts](docs/INTEGRATION_CONTRACTS.md). The supported release target is Windows with classic Outlook. Demo development and engine tests can run on other hosts; that does not establish their mailbox support.

## Development workflow

Use Node 22.14 or a newer supported Node 22 release. Run `npm ci`, `npm run dev`, and explore the synthetic demo. Keep a dedicated workspace outside the repository. Before a change, run the relevant behavioral tests. Before submitting:

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run smoke:desktop
```

Use synthetic addresses such as `person@example.test`. Never commit real email, extracted memory, workspace databases, screenshots of private work, credentials, or CLI history. The ignore file is a convenience, not a guarantee: inspect every file in the proposed contribution.

## Code boundaries

- React renders state and requests named operations. No filesystem, mailbox, or process execution belongs in UI components.
- Electron main owns sender validation, application/window lifecycle, and service RPC. Keep the sandboxed preload small.
- The service owns tasks, memory, jobs, persistence, and projections. Runtime validation belongs at trust boundaries, even when TypeScript types also exist.
- Mail connectors normalize source records and expose errors/capabilities. Preserve account/source identity and never deduplicate by subject.
- AI providers adapt commands and structured output. They cannot write task state directly or enable blanket tool trust.
- SQLite is authoritative. Markdown is rebuildable output; introduce an explicit validated import contract before adding editable projections.
- Preserve source provenance, optimistic revisions, manual tasks, and user corrections. Summaries and drafts are separate artifacts; unsent language is not a completed action or factual memory.

Use `npm run format` for the repository formatter. Keep changes focused and readable. Add an ADR for a meaningful storage, provider, lifecycle, or trust-boundary decision. When contracts change, update the runtime validator, renderer types, engine behavior, documentation, and synthetic tests together. Do not add abstractions for hypothetical integrations.

## Tests that matter

Cover failure and user behavior, especially duplicate ingestion, overlapping threads/tasks, moved source IDs, source edits, uncertain task matches, stale revisions, failed persistence, incomplete pages, timeout/cancellation, restart recovery, memory correction, and retention cleanup. Do not replace integration validation with tests that only assert a command string.

Unit/service tests need no credentials. `verify:outlook` is an explicit live check on Windows; explain that requirement in any contribution touching COM. Real AI and installer validation should use a dedicated test profile and sanitized context. Record Windows/Outlook/CLI versions and whether native or WSL execution was tested. Never include private message bodies in results.

## Contribution descriptions

Explain the user-visible problem, resulting behavior, implementation boundary, validation performed, and remaining integration limitations. Include reproduction steps with synthetic data. For changes to task inference, show how a proposed update remains linked to its evidence and how a user can correct it.

## Release readiness

The source repository is [nsb-labs/deep-work](https://github.com/nsb-labs/deep-work). Use its issues and pull requests for contributions. Before the first installer release, the maintainer must confirm source/asset licensing, enable private vulnerability reporting, complete Windows live checks, review dependency advisories, and verify installer contents/signing. Keep readiness claims tied to recorded evidence.
