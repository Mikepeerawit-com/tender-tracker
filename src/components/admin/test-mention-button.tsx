"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { sendTestMentionAction, type TestMentionState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

const initialState: TestMentionState = {};

/**
 * The one-off check that a colleague's WeCom userid actually reaches them.
 *
 * Disabled until there is a userid to test, because the alternative — posting a message
 * that mentions nobody and coming back `errcode 0` — looks exactly like success.
 *
 * The success wording deliberately does not say "delivered". WeCom accepts a wrong
 * userid without complaint, so all this button can honestly report is that the message
 * was posted; the colleague replying is what closes the loop.
 */
export function TestMentionButton({
  userId,
  hasUserid,
}: {
  userId: string;
  hasUserid: boolean;
}) {
  const t = useTranslations("people.wecom.test");
  const [state, formAction, isPending] = useActionState(
    sendTestMentionAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Button
        type="submit"
        variant="outline"
        disabled={isPending || !hasUserid}
        className="h-11"
      >
        {isPending ? t("sending") : t("send")}
      </Button>
      {state.status ? (
        <span
          role="status"
          className={
            state.status === "sent"
              ? "text-muted-foreground text-xs"
              : "text-destructive text-xs"
          }
        >
          {t(`status.${state.status}`)}
          {state.detail ? (
            <span className="text-muted-foreground"> ({state.detail})</span>
          ) : null}
        </span>
      ) : null}
    </form>
  );
}
