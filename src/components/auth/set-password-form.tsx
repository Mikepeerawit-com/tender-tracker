"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { setPasswordAction, type SetPasswordState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SetPasswordState = {};

export function SetPasswordForm() {
  const t = useTranslations("setPassword");
  const [state, formAction, isPending] = useActionState(setPasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {t(`error.${state.error}`)}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">{t("requirement")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmation">{t("confirmation")}</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
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
