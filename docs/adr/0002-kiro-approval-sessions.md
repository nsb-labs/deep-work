# ADR 0002: Kiro approvals belong to a live ACP session

Status: Accepted

## Context

Background email processing and task chat can encounter permissions in an organization-managed Kiro agent. The previous noninteractive stream could not accept user input mid-run. Revealing that stream in a terminal would not make it interactive. A user needs to see the requested action, approve or deny it, and continue the exact session that requested permission.

## Decision

Run Kiro through ACP v1 and render a collapsible global session console. Normalize permission requests inside the service, expose one-time options, and return the selected option to the original JSON-RPC request. Advertise no client filesystem or terminal tools. Keep the generated default Kiro agent tool-free; selected organization agents retain their existing configuration.

Approval callbacks, tool details and console text exist only in memory. Persist job status and minimal decision metadata. Decisions are scoped to random request IDs and job IDs, expire after five minutes and cannot survive process exit or application restart. Pause the execution timeout while waiting for approval, and cancel the live process when the user stops it. A separate Outlook scan can collect mail during the wait, using its own cancellation controller; inference remains serialized and source-version validation still applies.

## Consequences

This supports reliable structured approval choices without scraping terminal text, adding native PTY dependencies, or exposing arbitrary stdin/shell operations through IPC. The interface is a session console, not a raw interactive terminal emulator. Legacy TUI prompts and authentication must be handled in the configured CLI environment, followed by an explicit retry. Unsupported ACP versions fail visibly; compatibility with actual Windows/native/WSL Kiro versions is a required rollout check, not established by synthetic tests.

The provider adapter is independently testable against a synthetic duplex server; the job engine owns persistence and recovery; the UI only displays bounded output and sends named decisions. Future PTY support would need a separate lifecycle and input contract rather than weakening this approval boundary.

The session console is now shared with Codex. Provider identity is captured per queued job and does not change when preferences change. The header follows current preferences, while active cards retain the original provider. Codex streams task answers and structured-run progress into the same bounded buffers, retaining its existing read-only/never-approval policy. This does not add raw terminal input or Codex action approval support.
