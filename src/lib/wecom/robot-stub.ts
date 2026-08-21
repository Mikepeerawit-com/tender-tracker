import type { RobotBoundary } from "./robot";

/**
 * The test double for the group robot's outbound boundary — test-only, imported by no
 * shipping code.
 *
 * One stub rather than one per test file, so every test that stands at this boundary
 * asserts against the *same* recorded payload shape. Two hand-rolled stubs drift, and
 * the one that drifts is the one still passing.
 *
 * It records rather than waits. Pacing is ~3s between sends, so a three-message batch
 * against a real timer costs a test six seconds — expensive enough that the pacing
 * rule stops being asserted, which is how the 20-per-minute cap gets breached.
 */

/** An `errcode` body to answer with, or a bare HTTP status to fail with. */
export type RobotAnswer = { errcode: number; errmsg: string } | number;

export type SentMessage = {
  url: string;
  payload: { msgtype: string; text: { content: string; mentioned_list?: string[] } };
};

export type RobotStub = RobotBoundary & {
  /** What would have left the process, in order. */
  sent: SentMessage[];
  /** What the sender asked to wait between messages, in milliseconds. */
  waited: number[];
};

/**
 * A recording group robot. Answers each send from `answers` in turn, then `errcode 0`
 * for anything beyond them — the common case being a batch that all succeeds.
 */
export function recordingRobot(...answers: RobotAnswer[]): RobotStub {
  const sent: SentMessage[] = [];
  const waited: number[] = [];
  let call = 0;

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const answer = answers[call++] ?? { errcode: 0, errmsg: "ok" };

    sent.push({ url: String(input), payload: JSON.parse(String(init?.body)) });

    return typeof answer === "number"
      ? new Response("upstream said no", { status: answer })
      : Response.json(answer);
  };

  return {
    sent,
    waited,
    fetch: fetch as typeof globalThis.fetch,
    wait: async (ms: number) => void waited.push(ms),
  };
}

/** A robot that cannot be reached at all — the transport itself fails. */
export function unreachableRobot(message = "ECONNRESET"): RobotBoundary {
  return {
    fetch: (() => Promise.reject(new Error(message))) as typeof globalThis.fetch,
    wait: async () => {},
  };
}
