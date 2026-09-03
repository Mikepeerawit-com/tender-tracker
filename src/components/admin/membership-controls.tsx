"use client";

import { useActionState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { setMembershipDisabledAction, type MembershipState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

const initialState: MembershipState = {};

/**
 * Where a colleague who has left stops being able to sign in, and where one who comes
 * back starts again.
 *
 * **The last-Org-Admin rule is not restated here.** The button stays pressable and the
 * server refuses, because an org's admin count is a fact about rows this component cannot
 * see without the page handing it a rule to hold a second copy of — and the copy on the
 * screen is the one that goes stale. What the admin gets instead is the sentence saying
 * why, which is more than a greyed-out button would have told them.
 *
 * The icon is beside the label and never instead of it: this control is destructive in
 * one direction and restorative in the other, and a glyph alone leaves which one it is to
 * be inferred from a shape, in two scripts.
 *
 * The button reads **Restore** where the code says `readmit` — the schema calls
 * `disabled_at` the readmission gate and the status keeps that word, while the label layer
 * is free to say the one a colleague reads without translating first (CONTEXT.md,
 * Language).
 */
export function MembershipControls({
  userId,
  disabledAt,
}: {
  userId: string;
  disabledAt: string | null;
}) {
  const t = useTranslations("people.membership");
  const [state, formAction, isPending] = useActionState(
    setMembershipDisabledAction,
    initialState,
  );
  const readmitting = disabledAt !== null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="intent" value={readmitting ? "readmit" : "disable"} />
      <Button
        type="submit"
        variant="outline"
        disabled={isPending}
        className="h-11"
      >
        {readmitting ? (
          <UserPlus className="size-4" aria-hidden />
        ) : (
          <UserMinus className="size-4" aria-hidden />
        )}
        {readmitting ? t("restore") : t("disable")}
      </Button>
      {state.status ? (
        <span
          role="status"
          className={
            state.status === "disabled" || state.status === "readmitted"
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
