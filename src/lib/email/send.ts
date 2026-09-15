import "server-only";

import type { SendOutcome } from "@/lib/messaging/send-outcome";

/**
 * The email transport: the channel every customer has (ADR-0034).
 *
 * Resend, provisioned through the Vercel Marketplace, which supplies `RESEND_API_KEY`.
 * `EMAIL_FROM` is the sender — an address on the company's own verified domain, or the
 * mail is filed as spam. Both are read at the first real send and a blank one throws,
 * which is the webhook's posture: sending nowhere while reporting success is the silent
 * failure this seam exists to keep out of the product. `/api/health` is where a
 * deployment's configuration is caught before a morning run can be.
 *
 * ## An accepted email is not a read one
 *
 * Resend's 200 says the message was accepted for delivery, nothing more. No "delivered"
 * or "read" indicator may be built on this response — the one later fact that may ever
 * be surfaced is a bounce, which is the provider stating that a named address rejected
 * the message (ADR-0034). A rejected *request* shows up here instead, synchronously,
 * and is the one failure this transport reports as non-retryable: a bad address is bad
 * again every morning for ever, so the caller closes the delivery rather than queueing
 * a retry that cannot succeed.
 */

/** One email: exactly one reader, which is what lets its text carry their locale. */
export type EmailMessage = { to: string; subject: string; text: string };

/**
 * The outbound boundary, injected so tests can stand at it.
 *
 * Deliberately not a global `fetch` stub, for the reason ADR-0012 already records: the
 * send path is reached from code that also talks to Postgres over HTTP, and a global
 * stub takes `supabase-js` down with it. This is one of exactly three stubbed outbound
 * boundaries in the project — see the note in vitest.config.mts.
 */
export type EmailBoundary = {
  fetch?: typeof globalThis.fetch;
  /** Injected for the same reason the run instant is (ADR-0010): so a test costs no seconds. */
  wait?: (ms: number) => Promise<void>;
};

/**
 * How long to leave between sends.
 *
 * Resend documents 10 requests per second per team (api-reference/introduction, read
 * September 2026). 200ms is 5 a second — half the cap, so a catch-up burst stays
 * inside it by construction rather than by luck, the same posture as the robot's ~3s.
 */
export const emailPaceMs = 200;

const endpoint = "https://api.resend.com/emails";

/**
 * What the environment says about the email transport, for `/api/health` to report —
 * the same discriminated pair as `appOrigin`, and for the same reason: the send path
 * itself throws at the first real send rather than probing, so the place a deployment's
 * missing configuration is caught has to be the probe the deployment gate reads, not
 * the morning run that would otherwise be the first to notice.
 *
 * **This is also the one gate {@link sendEmails} throws on** — derived, not duplicated,
 * so the probe cannot report `configured` about an environment the send path would
 * refuse. That is why the sender's *shape* is checked here and not merely its presence:
 * a malformed `EMAIL_FROM` would be refused by the provider on every send, for every
 * recipient, and 4xx refusals close deliveries (ADR-0034) — a deployment-wide config
 * typo must be caught by this probe rather than paid for in settled rows nobody was
 * ever mailed.
 */
export type EmailConfig = { from: string; error: null } | { from: null; error: string };

/** `addr@domain`, or `Display Name <addr@domain>` — the two shapes Resend accepts. */
const senderShape = /^(?:[^<>\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]+<[^<>\s]+@[^<>@\s]+\.[^<>@\s]+>)$/;

export function emailConfig(): EmailConfig {
  const missing = ["RESEND_API_KEY", "EMAIL_FROM"].filter(
    (name) => (process.env[name] ?? "").trim() === "",
  );

  if (missing.length > 0) {
    return {
      from: null,
      error: `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set, so no reminder email can be sent.`,
    };
  }

  const from = (process.env.EMAIL_FROM ?? "").trim();

  return senderShape.test(from)
    ? { from, error: null }
    : {
        from: null,
        error: `EMAIL_FROM is not a sender Resend can accept — use "reminders@example.com" or "Name <reminders@example.com>".`,
      };
}

/**
 * Send a batch of emails, paced, reporting each one's fate.
 *
 * Outcomes come back aligned with `emails` by index. One failure does not abandon the
 * batch: the daily cron sends everybody's reminders in one run, and one unreachable
 * address must not silence the rest of the org.
 *
 * @throws when `RESEND_API_KEY` or `EMAIL_FROM` is blank — and only once there is
 * something to send, so a deployment that owes nobody anything is not a misconfiguration.
 */
export async function sendEmails(
  emails: EmailMessage[],
  boundary: EmailBoundary = {},
): Promise<SendOutcome[]> {
  // A run with nothing due is not a misconfiguration, so this comes first.
  if (emails.length === 0) return [];

  // The same gate `/api/health` probes, thrown rather than reported: one policy, so
  // the probe cannot call configured what this line would refuse.
  const config = emailConfig();

  if (config.error !== null) throw new Error(config.error);

  const from = config.from;
  const key = (process.env.RESEND_API_KEY ?? "").trim();

  const post = boundary.fetch ?? globalThis.fetch;
  const wait = boundary.wait ?? sleep;

  const outcomes: SendOutcome[] = [];

  for (const [index, email] of emails.entries()) {
    // Between sends, not before the first: a lone message pays no pacing cost.
    if (index > 0) await wait(emailPaceMs);

    outcomes.push(await send(post, key, from, email));
  }

  return outcomes;
}

async function send(
  post: typeof globalThis.fetch,
  key: string,
  from: string,
  email: EmailMessage,
): Promise<SendOutcome> {
  let response: Response;

  try {
    response = await post(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: email.to, subject: email.subject, text: email.text }),
    });
  } catch (cause) {
    return failure(true, null, reasonFrom(cause));
  }

  if (response.ok) return { ok: true };

  // 4xx is Resend refusing the request itself — above all a rejected address — which
  // will be refused identically tomorrow, so it is the failure that closes a delivery
  // (ADR-0034). Everything else (a throttle, an outage) is worth tomorrow's run. The
  // exceptions kept retryable are the deployment-shaped and time-shaped 4xxs: auth
  // (401/403 — a bad key or an unverified domain is a fault somebody will fix, after
  // which the rows must still be there to send), 408/409 (timeouts and conflicts are
  // transient however the status is classed), and 429. Closing a delivery over any of
  // those would settle rows nobody was ever mailed, unrecoverably — the config-shaped
  // half of that risk is also caught upstream, where {@link emailConfig} refuses a
  // malformed sender before a single request carries it.
  const retryable =
    response.status === 401 ||
    response.status === 403 ||
    response.status === 408 ||
    response.status === 409 ||
    response.status === 429 ||
    response.status >= 500;

  return failure(retryable, response.status, await detailOf(response));
}

/** Upstream's words, never ours — see `@/lib/messaging/send-outcome`. */
async function detailOf(response: Response): Promise<string> {
  let said = "";

  try {
    const body = (await response.json()) as { message?: string };

    said = typeof body.message === "string" ? `: ${body.message}` : "";
  } catch {
    // The status alone is still the fact worth carrying.
  }

  return `HTTP ${response.status}${said}`;
}

function failure(retryable: boolean, errcode: number | null, detail: string): SendOutcome {
  return { ok: false, retryable, errcode, detail };
}

function reasonFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
