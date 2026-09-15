import { afterEach, describe, expect, it, vi } from "vitest";

import { recordingEmail, refusingEmail, unreachableEmail } from "./email-stub";
import { emailPaceMs, sendEmails, type EmailMessage } from "./send";

/**
 * The email transport: the floor every customer has (ADR-0034), shaped on the robot's
 * suite because it stands at the same kind of seam. The assertions are about what
 * leaves the process and what the caller is told when it doesn't — an accepted email
 * is still not a read one, and nothing here claims otherwise.
 */

const message: EmailMessage = {
  to: "somchai@example.test",
  subject: "Subject",
  text: "Body",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendEmails", () => {
  it("posts to Resend with the key, from the configured sender", async () => {
    const boundary = recordingEmail();

    await sendEmails([message], boundary);

    expect(boundary.sent).toHaveLength(1);
    expect(boundary.sent[0].url).toBe("https://api.resend.com/emails");
    expect(boundary.sent[0].authorization).toMatch(/^Bearer .+/);
    expect(boundary.sent[0].payload).toMatchObject({
      to: "somchai@example.test",
      subject: "Subject",
      text: "Body",
    });
    expect(boundary.sent[0].payload.from).not.toBe("");
  });

  it("sends nothing, waits not at all, and never reads the key, for an empty batch", async () => {
    // A run with nothing due is not a misconfiguration. An org with no reminders owed
    // must not crash a deployment that has not configured email yet.
    vi.stubEnv("RESEND_API_KEY", "");

    const boundary = recordingEmail();

    expect(await sendEmails([], boundary)).toEqual([]);
    expect(boundary.sent).toEqual([]);
    expect(boundary.waited).toEqual([]);
  });

  it("throws on a blank key rather than reporting success", async () => {
    // The webhook's posture (ADR-0005): posting nowhere while reporting success is the
    // silent failure this seam exists to keep out of the product. /api/health is where
    // a deployment's configuration is caught.
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(sendEmails([message], recordingEmail())).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("throws on a blank sender for the same reason", async () => {
    vi.stubEnv("EMAIL_FROM", "");

    await expect(sendEmails([message], recordingEmail())).rejects.toThrow(/EMAIL_FROM/);
  });

  it("throws on a sender the provider would refuse, before a single request carries it", async () => {
    // A malformed EMAIL_FROM is a deployment-wide fault: every send would come back
    // 4xx, and 4xx closes deliveries (ADR-0034) — rows settled with zero mail sent,
    // unrecoverably. So the shape is checked at the same gate /api/health probes, and
    // the morning run never gets far enough to pay for the typo in settled rows.
    vi.stubEnv("EMAIL_FROM", "Tender Tracker reminders@example.test");

    await expect(sendEmails([message], recordingEmail())).rejects.toThrow(/EMAIL_FROM/);
  });

  it("reports an accepted email as sent", async () => {
    const outcomes = await sendEmails([message], recordingEmail());

    expect(outcomes).toEqual([{ ok: true }]);
  });

  it("treats a rate limit as retryable — tomorrow's run recovers it for free", async () => {
    const outcomes = await sendEmails([message], recordingEmail(429));

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: true, errcode: 429 });
  });

  it("treats a server failure as retryable", async () => {
    const outcomes = await sendEmails([message], recordingEmail(500));

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: true, errcode: 500 });
  });

  it("treats a timeout or conflict as retryable, whatever their status class", async () => {
    // Time-shaped 4xxs. Closing a delivery over one would settle a row nobody was
    // mailed, over a failure tomorrow's run would have cleared.
    const outcomes = await sendEmails([message, message], recordingEmail(408, 409));

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: true, errcode: 408 });
    expect(outcomes[1]).toMatchObject({ ok: false, retryable: true, errcode: 409 });
  });

  it("treats a rejected request as non-retryable — it will be rejected again for ever", async () => {
    // The one failure the robot can never report (ADR-0034): a rejected address is
    // rejected every morning until somebody fixes it, and retrying buys nothing.
    const outcomes = await sendEmails([message], recordingEmail(422));

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: false, errcode: 422 });
    expect(outcomes[0]).toHaveProperty("detail", expect.stringContaining("upstream said no"));
  });

  it("treats a refused validation the same way", async () => {
    const outcomes = await sendEmails([message], recordingEmail(400));

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: false, errcode: 400 });
  });

  it("hands a transport failure back rather than throwing it at the caller", async () => {
    const outcomes = await sendEmails([message], unreachableEmail());

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: true, errcode: null });
    expect(outcomes[0]).toHaveProperty("detail", expect.stringContaining("ECONNRESET"));
  });

  it("keeps sending the batch after one message fails, outcomes aligned by index", async () => {
    // One unreachable address must not silence the rest of the run.
    const boundary = refusingEmail((email) => email.to === "bad@example.test", 422);

    const outcomes = await sendEmails(
      [message, { ...message, to: "bad@example.test" }, message],
      boundary,
    );

    expect(boundary.sent).toHaveLength(3);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
  });

  it("paces sends to sit under the provider's documented rate limit", async () => {
    const boundary = recordingEmail();

    await sendEmails([message, message, message], boundary);

    // Between the sends, not before the first: three messages wait twice.
    expect(boundary.waited).toEqual([emailPaceMs, emailPaceMs]);
    // Resend documents 10 requests per second per team; anything at or above 100ms
    // stays inside it by construction, catch-up bursts included.
    expect(emailPaceMs).toBeGreaterThanOrEqual(100);
  });

  it("does not wait at all to send a single message", async () => {
    const boundary = recordingEmail();

    await sendEmails([message], boundary);

    expect(boundary.waited).toEqual([]);
  });
});
