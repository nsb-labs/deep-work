# ADR 0001: Local service owns work state

Status: accepted for the Windows-first implementation, 2026-10-03.

The original interface depended on missing Python email scripts, an interactive Kiro terminal, and AI rewrites of a shared brief. That made duplicate handling, provider switching, errors, and concurrent actions difficult to verify.

A separate Electron utility process now owns SQLite, task revisions, graph provenance, a durable serialized queue, and Markdown projections. Mail access goes through a classic Windows Outlook COM helper. AI adapters return structured proposals that the engine validates before changing state. The sandboxed renderer uses named operations. Kiro and Codex share the same input/result contract.

SQLite uses sql.js so the first release avoids native SQLite ABI builds. Its full-database snapshot persistence is simple and tested for save failures, but may need replacement after profiling larger workspaces. Markdown remains readable and referenceable while the database is authoritative; direct Markdown editing does not mutate work.

This decision enables deterministic synthetic development and provider-independent tests. It requires explicit review for existing-task AI changes and separate Windows validation for COM, CLI authentication/output, cancellation, and installer behavior. macOS, new Outlook, Graph, automated sending, and a hosted backend are outside current scope.
