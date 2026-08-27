"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { setUpAction, type SetupState } from "@/app/actions/setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SetupState = {};

export function SetupForm() {
  const t = useTranslations("setup");
  const [state, formAction, isPending] = useActionState(
    setUpAction,
    initialState,
  );

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
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          defaultValue={state.name}
          required
          className="h-11"
        />
      </div>

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
          defaultValue={state.email}
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="secret">{t("secret")}</Label>
        <Input
          id="secret"
          name="secret"
          type="password"
          autoComplete="off"
          required
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">{t("secretHint")}</p>
      </div>

      <Button type="submit" disabled={isPending} className="h-11 w-full">
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
