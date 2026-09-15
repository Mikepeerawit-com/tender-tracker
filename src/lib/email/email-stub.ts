import type { EmailBoundary } from "./send";

/**
 * The test double for the email transport's outbound boundary — test-only, imported by
 * no shipping code. The third stubbed outbound boundary in the project, shaped on
 * `@/lib/wecom/robot-stub` for the same reasons that one gives: one stub rather than
 * one per file, and recording rather than waiting.
 */

/** An HTTP status to answer with. `200` answers Resend's own success body. */
export type EmailAnswer = number;

export type SentEmail = {
  url: string;
  authorization: string | null;
  payload: { from: string; to: string; subject: string; text: string };
};

export type EmailStub = EmailBoundary & {
  /** What would have left the process, in order. */
  sent: SentEmail[];
  /** What the sender asked to wait between messages, in milliseconds. */
  waited: number[];
};

/**
 * A recording email provider. Answers each send from `answers` in turn, then accepts
 * anything beyond them — the common case being a batch that all succeeds.
 */
export function recordingEmail(...answers: EmailAnswer[]): EmailStub {
  return recording((_email, call) => answers[call] ?? 200);
}

/**
 * A provider that refuses the emails a predicate picks out, and accepts everything
 * else. By content rather than by position, for the reason the robot stub gives: the
 * daily run sweeps every org in the database, so which send lands first depends on
 * what a neighbouring suite happened to leave behind.
 */
export function refusingEmail(
  refuses: (email: SentEmail["payload"]) => boolean,
  answer: EmailAnswer = 500,
): EmailStub {
  return recording((email) => (refuses(email) ? answer : 200));
}

function recording(
  answerFor: (email: SentEmail["payload"], call: number) => EmailAnswer,
): EmailStub {
  const sent: SentEmail[] = [];
  const waited: number[] = [];
  let call = 0;

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as SentEmail["payload"];
    const answer = answerFor(payload, call++);
    const headers = new Headers(init?.headers);

    sent.push({ url: String(input), authorization: headers.get("authorization"), payload });

    return answer === 200
      ? Response.json({ id: crypto.randomUUID() })
      : Response.json(
          { statusCode: answer, name: "upstream_error", message: "upstream said no" },
          { status: answer },
        );
  };

  return {
    sent,
    waited,
    fetch: fetch as typeof globalThis.fetch,
    wait: async (ms: number) => void waited.push(ms),
  };
}

/** A provider that cannot be reached at all — the transport itself fails. */
export function unreachableEmail(message = "ECONNRESET"): EmailBoundary {
  return {
    fetch: (() => Promise.reject(new Error(message))) as typeof globalThis.fetch,
    wait: async () => {},
  };
}
