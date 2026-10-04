# Generic-default cleanup

> Historical cleanup notes from the earlier terminal-based prototype. The active Windows-first service implementation supersedes these behaviors. See [ARCHITECTURE.md](ARCHITECTURE.md) and [Windows setup](WINDOWS_SETUP.md) for current behavior.

This change removes personal contact matches, fixed business goals, and machine-specific launcher paths from the shipped source. Author attribution remains in `package.json`.

## Current behavior

- The dashboard and parser share generic section names: Priority, Important Contacts, Action Required, Projects, Reviews, Pending, Waiting On, and FYI.
- Projects use Project / Owner / Status / Update columns. Reviews use Item / Context / Status / Update columns, without assuming software development work.
- Agent startup instructions no longer supply a fixed list of business goals. They request user-configured goals when present and a general activity summary otherwise.
- Kiro remains the only implemented CLI integration. Generic action instructions now use the `buildAgentCommand` helper, but a provider adapter system is planned, not implemented.
- The app no longer supplies `--trust-all-tools` to Kiro. Users may need to approve tools inside the terminal; independently configured Kiro permissions still apply.
- Windows launchers resolve the app folder from their script location.
- `DEEPWORK_WORKSPACE` optionally overrides the legacy parent-directory workspace. `DEEPWORK_KIRO_PATH` optionally overrides the Windows Kiro executable path. These are process environment variables, not an implemented settings screen or automatically loaded `.env` file.
- Root-level private workspace data, mail exports, local settings, and database files are ignored by Git patterns. Ignore rules do not protect already tracked files or replace reviewing a release archive.

## Existing workspace migration

Existing private Markdown files are not modified by this cleanup. Back up your workspace first, then rename person-specific priority sections to `PRIORITY` and preferred-contact sections to `IMPORTANT CONTACTS`. Rename business-specific tracking sections to `PROJECTS` and review sections to `REVIEWS`.

Update table headers and meanings to match [the synthetic example](../examples/brief.md). Project columns are project, owner, status, update; review columns are item, context, status, update. Other table layouts remain unchanged. Unknown section headings are not displayed, so migrate before using an old brief with this version.

The internal activity tab IDs are now `priority`, `contacts`, and `projects` in place of the earlier personal/specialized tab IDs. External scripts that group events by those IDs may need updating. Existing JSONL events are untouched.

Also update any private prompts or external report scripts that recreate old headings or impose fixed goals. Those scripts are not included here and cannot be migrated by this source cleanup. Retain any genuine user preferences privately; do not copy them into the public examples.

## Scope

This is a source cleanup and product plan. Outlook access, 30-day indexing, adaptive categories, goals settings, and alternative CLI support are not implemented yet. The example file is a parser fixture, not an interactive demo mode. See [the current product architecture](PRODUCT_ARCHITECTURE.md) for the implementation sequence.
