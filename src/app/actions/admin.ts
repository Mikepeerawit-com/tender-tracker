"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { invite, setWecomUserid } from "@/lib/auth/invite";

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
