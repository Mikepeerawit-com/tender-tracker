import { describe, expect, it } from "vitest";

import { recordingRobot, unreachableRobot } from "./robot-stub";
import { paceMs, sendGroupMessages, type GroupMessage } from "./robot";

/**
 * The seam every outbound notification in v1 goes through: a plain HTTPS POST to the
 * org's Group Robot webhook. It is the *only* WeCom surface this project is not gated
 * out of, so it carries the whole notification story — which makes the way it fails the
 * thing worth testing.
 *
 * `errcode 0` means **accepted**, never **notified** (ticket 14, ADR-0005). Nothing
 * here asserts delivery, because nothing can: the assertions are about what leaves the
 * process and what the caller is told when it doesn't.
 */

const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key";

const message: GroupMessage = { content: "测试", mentions: ["somchai"] };

describe("sendGroupMessages", () => {
  it("posts to the webhook it was handed", async () => {
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [message], boundary);

    expect(boundary.sent.map((call) => call.url)).toEqual([webhook]);
  });

  it("refuses to send when there is no webhook to send to", async () => {
    // Callers resolve the org's Group Robot first (./group-robot.ts). Arriving here
    // without one is a bug, and posting nowhere while reporting success is precisely
    // the silent failure this seam exists to keep out of the product.
    await expect(sendGroupMessages("   ", [message], recordingRobot())).rejects.toThrow(
      /Group Robot/,
    );
  });

  it("sends `text`, the only message type that carries a mention", async () => {
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [message], boundary);

    expect(boundary.sent[0].payload).toMatchObject({ msgtype: "text" });
  });

  it("mentions by userid, in `mentioned_list`", async () => {
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [{ content: "测试", mentions: ["anong", "malee"] }], boundary);

    expect(boundary.sent[0].payload.text).toMatchObject({
      content: "测试",
      mentioned_list: ["anong", "malee"],
    });
  });

  it("never uses `mentioned_mobile_list`", async () => {
    // Both routes bind, but a mis-formatted mobile fails *systematically* — the format
    // a Thai person naturally types binds for nobody, so one mistake makes the whole
    // org silently unreachable at once. A typo'd userid drops exactly one person.
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [message], boundary);

    expect(JSON.stringify(boundary.sent[0].payload)).not.toContain("mentioned_mobile");
  });

  it("leaves the mention list out entirely when there is nobody to mention", async () => {
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [{ content: "每日摘要" }], boundary);

    expect(boundary.sent[0].payload.text).toEqual({ content: "每日摘要" });
  });

  it("reports a send accepted by WeCom as sent", async () => {
    const outcomes = await sendGroupMessages(webhook, [message], recordingRobot());

    expect(outcomes).toEqual([{ ok: true }]);
  });

  it("treats a non-zero errcode as retryable, and says which one", async () => {
    // Never mark a reminder `sent` on a non-zero errcode (ADR-0005): throttle behaviour
    // is unmeasured, so the row stays unsent and the catch-up rule recovers it.
    const boundary = recordingRobot({ errcode: 45009, errmsg: "api freq out of limit" });

    const outcomes = await sendGroupMessages(webhook, [message], boundary);

    expect(outcomes).toEqual([
      {
        ok: false,
        retryable: true,
        errcode: 45009,
        detail: "errcode 45009: api freq out of limit",
      },
    ]);
  });

  it("treats an HTTP failure as retryable, with no errcode to report", async () => {
    const boundary = recordingRobot(502);

    const outcomes = await sendGroupMessages(webhook, [message], boundary);

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: true, errcode: null });
  });

  it("hands a transport failure back rather than throwing it at the caller", async () => {
    // The daily cron sends a batch. One unreachable send must not abandon the rest.
    const outcomes = await sendGroupMessages(webhook, [message], unreachableRobot());

    expect(outcomes[0]).toMatchObject({ ok: false, retryable: true, errcode: null });
    expect(outcomes[0]).toHaveProperty("detail", expect.stringContaining("ECONNRESET"));
  });

  it("keeps sending the batch after one message fails", async () => {
    const boundary = recordingRobot({ errcode: 45009, errmsg: "throttled" });

    const outcomes = await sendGroupMessages(webhook, [message, message, message], boundary);

    expect(boundary.sent).toHaveLength(3);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, true, true]);
  });

  it("paces sends to stay inside the 20-per-minute cap", async () => {
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [message, message, message], boundary);

    // Between the sends, not before the first: three messages wait twice.
    expect(boundary.waited).toEqual([paceMs, paceMs]);
    expect(paceMs).toBeGreaterThanOrEqual(3_000);
  });

  it("does not wait at all to send a single message", async () => {
    const boundary = recordingRobot();

    await sendGroupMessages(webhook, [message], boundary);

    expect(boundary.waited).toEqual([]);
  });

  it("sends nothing, and waits not at all, for an empty batch", async () => {
    // And with no webhook at all: a run with nothing due is not a misconfiguration,
    // and an org that has not set up its robot yet must not crash the cron.
    const boundary = recordingRobot();

    const outcomes = await sendGroupMessages("", [], boundary);

    expect(outcomes).toEqual([]);
    expect(boundary.sent).toEqual([]);
    expect(boundary.waited).toEqual([]);
  });
});
