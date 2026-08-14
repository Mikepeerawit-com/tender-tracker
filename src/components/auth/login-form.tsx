"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { signInAction, type SignInState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignInState = {};

export function LoginForm({ linkError = false }: { linkError?: boolean }) {
  const t = useTranslations("login");
  const [state, formAction, isPending] = useActionState(signInAction, initialState);

  const error = state.error ?? (linkError ? ("link" as const) : undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {t(`error.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>

      <Button type="submit" disabled={isPending} className="h-11 w-full">
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
