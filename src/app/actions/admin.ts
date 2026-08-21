"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { invite, setWecomUserid } from "@/lib/auth/invite";
import { sendTestMention } from "@/lib/wecom/test-mention";

export type InviteState = {
  status?: "sent" | "not_admin" | "already_invited" | "send_failed" | "incomplete";
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

  revalidatePath("/admin/people");

  return { status: "sent" };
}

export type WecomState = { status?: "saved" | "not_admin" | "not_found" | "taken" };

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

  revalidatePath("/admin/people");

  return { status: "saved" };
}

/**
 * `detail` is WeCom's own answer on a refusal — an errcode, an HTTP status. It is kept
 * out of the message catalogue because it is protocol fact rather than wording: the
 * sentence the admin reads is translated, and this is bracketed after it.
 */
export type TestMentionState = {
  status?: "sent" | "not_admin" | "not_found" | "no_userid" | "send_failed";
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
