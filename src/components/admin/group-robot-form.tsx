"use client";

import { useActionState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { setGroupRobotAction, type GroupRobotState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: GroupRobotState = {};

/**
 * Where the org's Group Robot webhook is set.
 *
 * **The stored URL is never rendered here.** The box is always empty, and what the
 * screen reports is whether a robot is configured and when it last changed. The webhook
 * is a bearer credential — whoever holds it can post to the company group as this app —
 * and a page that could echo it is a page that eventually does, into a screenshot or a
 * shared browser.
 *
 * The box is a plain text input rather than a masked one, deliberately. The value
 * arrives by paste, it is validated the moment it is submitted, and it is never shown
 * again — so masking an always-empty field would signal secrecy without adding any,
 * while hiding a mis-paste at the one moment it can still be seen.
 */
export function GroupRobotForm({
  configured,
  updatedAt,
}: {
  configured: boolean;
  updatedAt: string | null;
}) {
  const t = useTranslations("groupRobot");
  const format = useFormatter();
  const [state, formAction, isPending] = useActionState(
    setGroupRobotAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className={configured ? "text-muted-foreground text-sm" : "text-sm"}>
        {configured
          ? t("configured", {
              when: updatedAt ? format.dateTime(new Date(updatedAt)) : "",
            })
          : t("notConfigured")}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="webhook">{t("label")}</Label>
        <Input
          id="webhook"
          name="webhook"
          type="url"
          defaultValue=""
          placeholder={t("placeholder")}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">{t("help")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("saving") : t("save")}
        </Button>
        {configured ? (
          <Button
            type="submit"
            name="intent"
            value="clear"
            variant="outline"
            disabled={isPending}
            className="h-11"
          >
            {t("remove")}
          </Button>
        ) : null}
        {state.status ? (
          <span
            role="status"
            className={
              state.status === "saved" || state.status === "cleared"
                ? "text-muted-foreground text-xs"
                : "text-destructive text-xs"
            }
          >
            {t(`status.${state.status}`)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
