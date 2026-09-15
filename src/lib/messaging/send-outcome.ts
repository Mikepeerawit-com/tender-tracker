/**
 * What happened to one outbound send, in the terms every transport reports (ADR-0034).
 *
 * One type for both transports, because the caller's question is the same either way:
 * is this message done, and if not, is tomorrow's run worth spending on it?
 *
 * **`retryable: false` exists for email and email alone.** WeCom's throttle response is
 * unmeasured, so nothing on that side distinguishes "will never work" from "try again"
 * and the robot reports every failure as retryable (ADR-0005 recovers the row on the
 * next run for free). A rejected address is different in kind: it will be rejected
 * again every morning for ever, so retrying it buys a daily failure and nothing else.
 * A non-retryable failure closes the delivery instead of queueing it.
 *
 * `errcode` is the provider's own numeric code — WeCom's `errcode`, or the HTTP status
 * an email provider answered with — and null when the call never got far enough to
 * receive one.
 *
 * `detail` is **upstream's words, never ours** — it reaches a screen, and a screen is
 * translated (ADR-0011). English sentences composed here would arrive untranslated on
 * a zh-Hans screen and escape the message catalogue's parity test entirely, so the
 * wording a human reads lives in `src/messages/` and this carries only the protocol
 * facts that catalogue cannot know.
 */
export type SendOutcome =
  | { ok: true }
  | { ok: false; retryable: boolean; errcode: number | null; detail: string };
