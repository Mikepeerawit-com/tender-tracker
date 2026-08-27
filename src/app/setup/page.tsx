import { getTranslations } from "next-intl/server";

import { AuthScreen } from "@/components/auth/auth-screen";
import { SetupForm } from "@/components/auth/setup-form";
import { setupIsOpen } from "@/lib/auth/setup";

/**
 * Where the first Org Admin is created, once per database.
 *
 * Reachable signed-out — it has to be, since there is nobody to be signed in as — so it
 * is in `publicPaths` alongside the login. What keeps it from being a way in is
 * `setupIsOpen`: an unset `SETUP_SECRET` or a single existing account and this renders a
 * notice instead of a form. See ADR-0017 and `@/lib/auth/setup`.
 *
 * The closed notice says the app already has an account rather than pretending the route
 * does not exist. Whoever reads it is either the operator who ran setup already, or
 * somebody who has learned that a deployed app has users — and a 404 would mislead the
 * first while telling the second nothing they could not infer from the login screen.
 */
export default async function SetupPage() {
  const t = await getTranslations("setup");
  const open = await setupIsOpen();

  if (!open) {
    return (
      <AuthScreen
        title={t("closed.title")}
        description={t("closed.description")}
      >
        {/*
          A plain anchor, not `next/link`: `AuthScreen` is built for the WeCom in-app
          webview and states that it assumes no client-side routing. Whoever reads this
          has nowhere else to go, so the notice has to carry the way out rather than
          leaving them to guess at a URL in a webview with no address bar.
        */}
        <a
          href="/login"
          className="text-primary flex h-11 items-center justify-center text-sm font-medium underline underline-offset-4"
        >
          {t("closed.signIn")}
        </a>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t("title")} description={t("description")}>
      <SetupForm />
    </AuthScreen>
  );
}
