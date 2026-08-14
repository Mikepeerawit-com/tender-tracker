import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthScreen } from "@/components/auth/auth-screen";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { currentUser } from "@/lib/auth/session";

/**
 * Where an accepted invite lands. Reached with a session already in hand — /auth/confirm
 * exchanged the one-use token for one — so this only needs to turn that session into a
 * password the invitee can sign back in with.
 */
export default async function SetPasswordPage() {
  const user = await currentUser(await cookies());

  if (!user) redirect("/login?error=link");

  const t = await getTranslations("setPassword");

  return (
    <AuthScreen title={t("title")} description={t("description", { name: user.name })}>
      <SetPasswordForm />
    </AuthScreen>
  );
}
