# Open-source readiness plan

> Historical initial assessment, retained for context. The Windows-first implementation replaces several observations below. Read [ARCHITECTURE.md](ARCHITECTURE.md), [WINDOWS_SETUP.md](WINDOWS_SETUP.md), and [CONTRIBUTING.md](../CONTRIBUTING.md) for current behavior and outstanding release checks.

## Initial assessment

Assessed from the supplied source on 2026-10-03. This folder is not currently a Git repository. Dependencies were not installed and the app was not launched during this assessment; runtime behavior, packaging, and dependency security remain unverified.

DeepWork already has the interface for a useful file-backed email workflow. The largest gap is reproducibility: another developer cannot reproduce the complete workflow using this folder alone. Open-source readiness requires making that workflow portable, defining its trust boundaries, and documenting how contributors can change and verify it.

## 1. Make a fresh checkout useful

**Observed:** `electron/main.ts` derives the workspace from the application location and launches a Windows-specific Kiro executable. Python integrations are absent. Dashboard labels, parser matches, and agent prompts include personal contacts and business-specific goals.

**Work:**

- Introduce explicit workspace, CLI executable, and Python interpreter settings, with validation and actionable setup errors.
- Provide a synthetic example workspace and a demo mode that does not require email credentials, Python scripts, or an AI account.
- Make dashboard categories, priority contacts, and reporting goals configurable; preserve compatibility for existing personal workspaces.
- Document the external integration contract and decide whether the Python backend will be included or maintained separately.
- Resolve launcher paths relative to their own location and test workspace selection independently of installation paths.

**Done when:** a contributor can install dependencies and explore a populated demo from a clean checkout without private files or credentials. Live integration features explain missing prerequisites and remain disabled until configured.

## 2. Establish safe desktop boundaries

**Observed:** filesystem handlers call `path.resolve` without enforcing containment; IPC handlers do not validate senders or argument shapes; the Python handler accepts a script path from the renderer; Kiro starts with automatic tool trust. Context isolation is enabled and renderer Node integration is disabled, but renderer sandboxing is explicitly disabled.

**Work:**

- Validate IPC senders and inputs; restrict filesystem access to the selected workspace, including symlink escape handling.
- Expose named integration operations instead of arbitrary renderer-provided Python scripts.
- Make agent permissions an explicit user choice and remove blanket tool trust as the default.
- Define navigation, new-window, external-link, and content-security policies; evaluate enabling the renderer sandbox.
- Specify how email content and other untrusted text enter agent prompts, and how users review consequential actions.

**Done when:** tests cover rejected paths, symlink escapes, invalid IPC arguments, and unauthorized senders; the default launch does not enable blanket tool trust.

These are source-level findings for follow-up, not claims of a verified exploit or a completed security review.

## 3. Make behavior verifiable

**Observed:** there are no test or lint scripts, CI workflows, or explicit release packaging configuration in the supplied folder. `dist` skips the TypeScript step used by `build`. The terminal store holds one pending command, and the terminal consumes it even before a PTY ID exists. Re-indexing continues without checking Python exit codes. Reply regeneration deletes the previous output before instructing the agent to read it.

**Work:**

- Pin and verify a development runtime, install from the lockfile, and establish a passing build baseline.
- Type-check both renderer and Electron code explicitly; add linting and formatting conventions.
- Test the Markdown parser against valid, empty, malformed, and escaped-pipe fixtures.
- Replace the single pending command slot with explicit readiness and queuing behavior.
- Handle process failures before reporting completion or sending follow-up agent commands.
- Preserve the previous draft during regeneration and isolate outputs for concurrent requests.
- Test PTY cleanup during React mount/unmount and startup races, and file watching when files are created or atomically replaced.
- Add CI for type checking, focused tests, and builds; verify native PTY loading on each claimed platform.

**Done when:** these workflows have deterministic tests, CI passes from a clean checkout, and a failed integration cannot appear successful in the UI.

## 4. Prepare the contributor and release experience

**Work:**

- Add the MIT license text corresponding to the existing package declaration and confirm rights to distributed code/assets.
- Add contribution instructions, a code of conduct, issue/PR templates, and a security reporting policy with a real reporting channel.
- Expand ignore rules for private email data, generated workspaces, credentials, and local settings; review intended publication contents.
- Initialize Git and configure the intended public repository when its destination is selected.
- Document the brief format, integration contracts, supported platforms, architecture, and data handling.
- Configure packaging with an explicit file allowlist and native-module handling; ensure personal workspace files are excluded.
- Define versioning, changelog, release checks, and platform signing requirements before publishing installers.
- Review dependency advisories and supported versions against current upstream sources as part of the implementation phase.

**Done when:** a new contributor can run checks from the documentation, maintainers have a real security reporting route, and release contents are reproducible and reviewed.

## Proposed first implementation milestone

Deliver configurable workspace selection, synthetic demo data, prerequisite detection, generic category configuration, and a verified build. This makes the project usable by someone other than its original author and supplies fixtures for the desktop-boundary and reliability work. Complete those checks before describing the project as ready for a public release.
