import "server-only";

import type { Locale } from "@/i18n/config";
import type { ThemeChoice } from "@/lib/theme/config";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

/**
 * Record the language a user chose.
 *
 * `users.locale` is nullable and starts null on purpose: first start-up asks rather
 * than inferring from `Accept-Language`. A colleague working from China and one in
 * Bangkok would otherwise silently get different apps, and neither would know there was
 * a switch.
 *
 * Written through the session client, so it goes through the column grant that lets a
 * member edit `name` and `locale` on their own row and nothing else.
 */
export async function chooseLocale(
  locale: Locale,
  store: SessionCookieStore,
): Promise<{ ok: boolean }> {
  const supabase = createSessionClient(store);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false };

  const { error } = await supabase
    .from("users")
    .update({ locale })
    .eq("id", user.id);

  return { ok: error === null };
}

/**
 * Record how a user wants the app painted.
 *
 * `users.theme` is `not null default 'system'`, so unlike `locale` there is never a
 * moment where the answer is missing — a member who has never opened Preferences follows
 * their device, and this is only ever the record of somebody changing their mind
 * (ADR-0024).
 *
 * Written through the session client for the reason {@link chooseLocale} is: it goes
 * through the column grant that lets a member edit `name`, `locale` and `theme` on their
 * own row and nothing else, so a call aimed at a colleague is refused by the database
 * rather than by this function remembering to check.
 */
export async function chooseTheme(
  theme: ThemeChoice,
  store: SessionCookieStore,
): Promise<{ ok: boolean }> {
  const supabase = createSessionClient(store);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false };

  const { error } = await supabase
    .from("users")
    .update({ theme })
    .eq("id", user.id);

  return { ok: error === null };
}
