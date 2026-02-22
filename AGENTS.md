# AGENTS

## Event-Driven State Rules

- Treat server notifications as eventually ordered signals.
  When correctness depends on final server truth (auth/session state), always include a state re-read path instead of relying on a single notification type.
- Prevent overlapping poll cycles for the same stream.
  Poll loops must be single-flight so delayed responses do not cause duplicated event handling.
- Apply strict runtime type guards at reducer boundaries.
  Ignore malformed payloads and keep state unchanged on invalid input.

## Approval Flow Safety

- Keep approval UX retryable.
  Pending approval requests must remain visible until backend acknowledgment is confirmed.
- Fallback decisions are a safety mechanism, not a replacement for user choice.
  If both primary and fallback sends fail, preserve the pending request and surface recovery guidance.
- Auto-resolution is allowed only when approval UI cannot be presented.
  Any auto-resolution failure must keep the request recoverable by the user.

## Diagnostics and Error UX

- Diagnostics level settings must have observable runtime effect, including exported logs.
- User-facing errors must be actionable and stable.
  Map internal errors to guidance-oriented messages while keeping raw details in diagnostics output.

## Test Expectations

- Add unit tests for malformed event payload handling and state-machine edge transitions.
- Add UI/integration coverage for failure paths where retryability is required (approval send failures, auth state recovery, polling overlap guards).
