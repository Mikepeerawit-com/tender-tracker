"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  invite,
  setWecomUserid,
  type InviteStatus,
  type WecomUserIdStatus,
} from "@/lib/auth/invite";
import { setFxBuffer, type FxBufferStatus } from "@/lib/org/fx-buffer";
import {
  setMembershipDisabled,
  type MembershipDisableStatus,
} from "@/lib/org/members";
import { runInstantFromHeaders } from "@/lib/run-instant";
import { setGroupRobot, type GroupRobotSaveStatus } from "@/lib/wecom/group-robot";
import { sendTestMention, type TestMentionStatus } from "@/lib/wecom/test-mention";

export type InviteState = {
  status?: InviteStatus;
};

export async function inviteAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!email || !name) return { status: "incomplete" };

  const result = await invite({ email, name }, await cookies());

  if (!result.ok) return { status: result.reason };

  revalidatePath("/settings/people");

  return { status: "sent" };
}

export type WecomState = { status?: WecomUserIdStatus };

export async function setWecomUseridAction(
  _previous: WecomState,
  formData: FormData,
): Promise<WecomState> {
  const userId = String(formData.get("userId") ?? "");
  const value = String(formData.get("wecomUserid") ?? "").trim();

  const result = await setWecomUserid(
    // Clearing it is a real operation: someone leaves WeCom before they leave the
    // company, and a stale userid @mentions nobody while looking like it works.
    { userId, wecomUserid: value === "" ? null : value },
    await cookies(),
  );

  if (!result.ok) return { status: result.reason };

  revalidatePath("/settings/people");

  return { status: "saved" };
}

/**
 * `detail` is WeCom's own answer on a refusal — an errcode, an HTTP status. It is kept
 * out of the message catalogue because it is protocol fact rather than wording: the
 * sentence the admin reads is translated, and this is bracketed after it.
 */
export type TestMentionState = {
  status?: TestMentionStatus;
  detail?: string;
};

export async function sendTestMentionAction(
  _previous: TestMentionState,
  formData: FormData,
): Promise<TestMentionState> {
  const userId = String(formData.get("userId") ?? "");

  const result = await sendTestMention({ userId }, await cookies());

  // Nothing was written, so nothing is revalidated. The answer to "did it arrive" is
  // not on this page and never will be — it is the colleague replying in WeCom.
  if (result.ok) return { status: "sent" };

  return result.reason === "send_failed"
    ? { status: result.reason, detail: result.detail }
    : { status: result.reason };
}

export type MembershipState = { status?: MembershipDisableStatus };

/**
 * End a colleague's Membership when they leave, or restore it when they come back.
 *
 * One action for both directions, told apart by the intent the button carries, because
 * they are the same write with two values — and a screen that could only end one would
 * make coming back a database job.
 *
 * The instant is resolved here and passed down, never read inside the write (ADR-0010).
 */
export async function setMembershipDisabledAction(
  _previous: MembershipState,
  formData: FormData,
): Promise<MembershipState> {
  const userId = String(formData.get("userId") ?? "");
  const readmitting = String(formData.get("intent") ?? "") === "readmit";

  const result = await setMembershipDisabled(
    {
      userId,
      disabledAt: readmitting ? null : runInstantFromHeaders(await headers()),
    },
    await cookies(),
  );

  if (!result.ok) return { status: result.reason };

  revalidatePath("/settings/people");

  return { status: readmitting ? "readmitted" : "disabled" };
}

export type GroupRobotState = {
  status?: GroupRobotSaveStatus;
};

/**
 * Set or remove the org's Group Robot webhook.
 *
 * Removing is a real operation with its own button, rather than saving an empty box: a
 * group gets recreated, or the URL leaks, and revoking it is the thing you want to be
 * able to do without a deploy. Clearing by accident should take a deliberate press.
 */
export async function setGroupRobotAction(
  _previous: GroupRobotState,
  formData: FormData,
): Promise<GroupRobotState> {
  const clearing = String(formData.get("intent") ?? "") === "clear";
  const webhook = clearing ? null : String(formData.get("webhook") ?? "");

  const result = await setGroupRobot({ webhook }, await cookies());

  if (!result.ok) return { status: result.reason };

  revalidatePath("/settings/group-robot");

  return { status: clearing ? "cleared" : "saved" };
}

export type FxBufferState = {
  status?: FxBufferStatus;
};

/**
 * Set how much is added to the market exchange rate when a foreign price is converted.
 *
 * The percentage arrives as the string the box held rather than as a number: reading it
 * is the whole risk here — a 2 meant as 2% and stored as 2 triples every foreign price
 * entered afterwards — so it is done in one place, `parseBufferPercent`, which a test can
 * stand at. `Number()` here would put the conversion somewhere nothing can check.
 *
 * Nothing is passed for the old value and nothing needs to be: the setting is one column
 * with one writer, and a change reaches the next Quote rather than any that already
 * froze a rate.
 */
export async function setFxBufferAction(
  _previous: FxBufferState,
  formData: FormData,
): Promise<FxBufferState> {
  const result = await setFxBuffer(
    { entered: String(formData.get("percent") ?? "") },
    await cookies(),
  );

  if (!result.ok) return { status: result.reason };

  revalidatePath("/settings/currency-conversion");

  return { status: "saved" };
}
