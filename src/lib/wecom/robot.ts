import "server-only";

/**
 * The WeCom group-robot webhook: the one outbound integration in v1.
 *
 * A plain HTTPS POST to a URL the org owns. No access token, no app credentials, no
 * OAuth, no domain of ours — it is the single WeCom surface exempt from every gate this
 * project hit (ADR-0008, docs/research/14-wecom-mention-targeting.md).
 *
 * The URL comes from `./group-robot.ts`, not from the environment: it is a per-org
 * setting an Org Admin changes in the app (ADR-0013). It is also a bearer credential —
 * whoever holds it can post to the company group as this app — so it is passed in
 * explicitly rather than reached for, and never logged.
 *
 * ## `errcode 0` means accepted, never notified
 *
 * Measured in ticket 14: a nonexistent userid and an empty string are each accepted
 * silently, return `{"errcode":0}`, and notify nobody. **No "delivered", "notified" or
 * "sent to" indicator may ever be built on this response**, anywhere in the UI. A
 * `wecom_userid` is trustworthy only once a human has confirmed receipt — which is what
 * `sendTestMention` in ./test-mention.ts exists for.
 *
 * The other half of the same rule lives in ADR-0005: never mark a reminder `sent` on a
 * non-zero errcode. Every failure here is therefore reported as retryable, and the
 * caller leaves its row alone.
 */

/** A message the robot can post. `mentions` are **userids**, never mobile numbers. */
export type GroupMessage = { content: string; mentions?: string[] };

/**
 * What happened to one send. Failure is always retryable: WeCom's throttle response is
 * unmeasured, so nothing here distinguishes "will never work" from "try again", and
 * ADR-0005's catch-up semantics recover an unsent row on the next run for free.
 *
 * `errcode` is null when the call never got far enough to receive one.
 *
 * `detail` is **upstream's words, never ours** — WeCom's `errcode`/`errmsg`, an HTTP
 * status, or the transport's own error. It reaches an Org Admin's screen, and a screen
 * is translated (ADR-0011); English sentences composed here would arrive untranslated
 * on a zh-Hans screen and escape the message catalogue's parity test entirely. So the
 * wording a human reads lives in `src/messages/`, and this carries only the protocol
 * facts that catalogue cannot know.
 */
export type SendOutcome =
  | { ok: true }
  | { ok: false; retryable: true; errcode: number | null; detail: string };

/**
 * The outbound boundary, injected so tests can stand at it.
 *
 * Deliberately not a global `fetch` stub: the send path is reached from server actions
 * that also talk to Postgres over HTTP, and stubbing `fetch` globally would take
 * `supabase-js` down with it. This is one of exactly two stubbed outbound boundaries in
 * the project — see the note in vitest.config.mts.
 */
export type RobotBoundary = {
  fetch?: typeof globalThis.fetch;
  /** Injected for the same reason the run instant is (ADR-0010): so a test costs no seconds. */
  wait?: (ms: number) => Promise<void>;
};

/**
 * How long to leave between sends.
 *
 * The webhook is capped at 20 messages per minute. ~3s apart is ≈17/min, which keeps a
 * catch-up burst — a missed cron run landing two days of reminders at once — inside the
 * cap by construction rather than by luck (ticket 14 §4).
 */
export const paceMs = 3_000;

type TextPayload = {
  msgtype: "text";
  text: { content: string; mentioned_list?: string[] };
};

/**
 * Post a batch of messages to the org's Group Robot, paced, reporting each one's fate.
 *
 * Outcomes come back aligned with `messages` by index. One failure does not abandon the
 * batch: the daily cron sends everybody's reminders in one run, and one unreachable
 * send must not silence the rest of the org.
 *
 * @throws when `webhook` is blank. Callers resolve it from the org first and report an
 * unconfigured robot as exactly that — an org that has not set one up yet is a
 * different thing from a send that failed, and only one of them is worth retrying.
 */
export async function sendGroupMessages(
  webhook: string,
  messages: GroupMessage[],
  boundary: RobotBoundary = {},
): Promise<SendOutcome[]> {
  // A run with nothing due is not a misconfiguration, so this comes first.
  if (messages.length === 0) return [];

  if (webhook.trim() === "") {
    throw new Error("The Group Robot has no webhook; resolve it before sending.");
  }

  const post = boundary.fetch ?? globalThis.fetch;
  const wait = boundary.wait ?? sleep;

  const outcomes: SendOutcome[] = [];

  for (const [index, message] of messages.entries()) {
    // Between sends, not before the first: a lone message pays no pacing cost.
    if (index > 0) await wait(paceMs);

    outcomes.push(await send(post, webhook, message));
  }

  return outcomes;
}

async function send(
  post: typeof globalThis.fetch,
  webhook: string,
  message: GroupMessage,
): Promise<SendOutcome> {
  let response: Response;

  try {
    response = await post(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(message)),
    });
  } catch (cause) {
    return retryable(null, reasonFrom(cause));
  }

  if (!response.ok) {
    return retryable(null, `HTTP ${response.status}`);
  }

  let body: { errcode?: number; errmsg?: string };

  try {
    body = (await response.json()) as { errcode?: number; errmsg?: string };
  } catch (cause) {
    return retryable(null, `HTTP ${response.status}: ${reasonFrom(cause)}`);
  }

  // An absent errcode is not a success. Treat anything that is not an explicit 0 as a
  // failure, so a changed response shape fails closed rather than silently "delivering".
  return body.errcode === 0
    ? { ok: true }
    : retryable(
        body.errcode ?? null,
        `errcode ${body.errcode ?? "absent"}${body.errmsg ? `: ${body.errmsg}` : ""}`,
      );
}

/**
 * `text` is the only message type WeCom lets carry a mention, so it is the only one this
 * seam sends — which is what makes "no message that mentions anyone uses markdown" a
 * property of the code rather than a rule to remember.
 */
function payload({ content, mentions }: GroupMessage): TextPayload {
  return {
    msgtype: "text",
    text: {
      content,
      // Omitted rather than sent empty: `[""]` is accepted and notifies nobody, so an
      // empty list is indistinguishable from a real mention in the response.
      ...(mentions?.length ? { mentioned_list: mentions } : {}),
    },
  };
}

function retryable(errcode: number | null, detail: string): SendOutcome {
  return { ok: false, retryable: true, errcode, detail };
}

function reasonFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
