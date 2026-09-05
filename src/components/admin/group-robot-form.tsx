"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
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
  const [state, formAction] = useActionState(setGroupRobotAction, initialState);

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
        <Buttons configured={configured} />
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

/**
 * The two acts this form offers, and which of them is under way.
 *
 * **A component of its own so that it can ask `useFormStatus`**, which answers only for a
 * form above it in the tree. `useActionState`'s `isPending` says that *the form* is in
 * flight and this form has two submits in it, so a word derived from that alone would put
 * *Saving…* and *Removing…* on screen together and let the reader pick (#144).
 * `useFormStatus` hands back what was actually posted, and *Remove* is the button carrying
 * `intent=clear` — so the answer comes from the submission rather than from a click. That
 * matters twice over: a keyboard submit from inside the box is a Save and no `onClick`
 * would ever have seen it, and a flag set on click would still be saying *Removing…* long
 * after a refused Remove, on a button nobody had touched.
 */
function Buttons({ configured }: { configured: boolean }) {
  const t = useTranslations("groupRobot");
  const { pending, data } = useFormStatus();
  const clearing = pending && data?.get("intent") === "clear";

  return (
    <>
      <Button type="submit" disabled={pending} className="h-11">
        {pending && !clearing ? t("saving") : t("save")}
      </Button>
      {configured ? (
        <Button
          type="submit"
          name="intent"
          value="clear"
          variant="outline"
          disabled={pending}
          className="h-11"
        >
          {clearing ? t("removing") : t("remove")}
        </Button>
      ) : null}
    </>
  );
}
