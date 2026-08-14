"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { setWecomUseridAction, type WecomState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: WecomState = {};

export function WecomUseridForm({
  userId,
  value,
}: {
  userId: string;
  value: string | null;
}) {
  const t = useTranslations("people.wecom");
  const [state, formAction, isPending] = useActionState(
    setWecomUseridAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Input
        name="wecomUserid"
        defaultValue={value ?? ""}
        placeholder={t("placeholder")}
        aria-label={t("label")}
        autoCapitalize="none"
        autoCorrect="off"
        className="h-11 max-w-56"
      />
      <Button type="submit" variant="outline" disabled={isPending} className="h-11">
        {t("save")}
      </Button>
      {state.status ? (
        <span
          role="status"
          className={
            state.status === "saved"
              ? "text-muted-foreground text-xs"
              : "text-destructive text-xs"
          }
        >
          {t(`status.${state.status}`)}
        </span>
      ) : null}
    </form>
  );
}
