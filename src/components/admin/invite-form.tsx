"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { inviteAction, type InviteState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: InviteState = {};

export function InviteForm() {
  const t = useTranslations("people.invite");
  const [state, formAction, isPending] = useActionState(inviteAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status ? (
        <p
          role="status"
          className={
            state.status === "sent"
              ? "border-border bg-muted rounded-lg border px-3 py-2 text-sm"
              : "border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
          }
        >
          {t(`status.${state.status}`)}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="invite-name">{t("name")}</Label>
          <Input id="invite-name" name="name" required className="h-11" />
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="invite-email">{t("email")}</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            required
            className="h-11"
          />
        </div>

        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
