"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  addAssigneeAction,
  removeAssigneeAction,
  type TenderFormState,
} from "@/app/actions/tenders";
import { TenderProblemNotice } from "@/components/tenders/tender-problem";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Member } from "@/lib/org/members";

const initialState: TenderFormState = {};

/**
 * Who is working this Tender.
 *
 * Adding yourself is one button and asks nobody, because Assignees compete rather than
 * divide (ADR-0004) and the step exists to enrol you in the Tender's reminders before
 * you start ringing suppliers. Adding or removing someone else is the Owner's, and the
 * picker only renders for them — the real gate is in the server action.
 */
export function AssigneeControls({
  tenderId,
  assignees,
  members,
  callerId,
  isOwner,
}: {
  tenderId: string;
  assignees: Member[];
  members: Member[];
  callerId: string;
  isOwner: boolean;
}) {
  const t = useTranslations("tenders.assignees");

  const assigned = new Set(assignees.map((assignee) => assignee.id));
  const unassigned = members.filter((member) => !assigned.has(member.id));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium">{t("title")}</h2>

      {assignees.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignees.map((assignee) => (
            <li key={assignee.id} className="flex items-center gap-3">
              <span className="text-sm">{assignee.name}</span>
              {isOwner || assignee.id === callerId ? (
                <RemoveForm
                  tenderId={tenderId}
                  userId={assignee.id}
                  label={assignee.id === callerId ? t("removeMe") : t("remove")}
                  pendingLabel={
                    assignee.id === callerId ? t("removingMe") : t("removing")
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {assigned.has(callerId) ? null : (
          <AddForm
            tenderId={tenderId}
            userId={callerId}
            label={t("addMe")}
            pendingLabel={t("addingMe")}
          />
        )}

        {isOwner && unassigned.length > 0 ? (
          <AddPicker tenderId={tenderId} members={unassigned} />
        ) : null}
      </div>
    </section>
  );
}

function AddForm({
  tenderId,
  userId,
  label,
  pendingLabel,
}: {
  tenderId: string;
  userId: string;
  label: string;
  /** What the button says while the write is in flight — see {@link RemoveForm}. */
  pendingLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(addAssigneeAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="userId" value={userId} />

      <TenderProblemNotice error={state.error} />

      <Button type="submit" variant="outline" disabled={isPending} className="h-11">
        {isPending ? pendingLabel : label}
      </Button>
    </form>
  );
}

function AddPicker({ tenderId, members }: { tenderId: string; members: Member[] }) {
  const t = useTranslations("tenders.assignees");
  const [state, formAction, isPending] = useActionState(addAssigneeAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenderId" value={tenderId} />

      <TenderProblemNotice error={state.error} />

      <div className="flex items-center gap-2">
        <NativeSelect
          name="userId"
          aria-label={t("pick")}
          className="h-11 w-auto min-w-44"
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" disabled={isPending} className="h-11">
          {isPending ? t("adding") : t("add")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Taking one person off, whether that is themselves or a colleague.
 *
 * Both words are handed in rather than chosen here, because the caller is the only thing
 * that knows which of the two this row is — and the pending word has to be the *same*
 * kind of sentence as the idle one. *Take me off* becoming *Taking you off…* is what
 * makes the second press unnecessary; a shared *Removing…* under both would be a control
 * that answered in a voice it does not otherwise use (#144).
 */
function RemoveForm({
  tenderId,
  userId,
  label,
  pendingLabel,
}: {
  tenderId: string;
  userId: string;
  label: string;
  /** What it says instead, for as long as the write is in flight. */
  pendingLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(
    removeAssigneeAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="userId" value={userId} />

      <Button type="submit" variant="ghost" size="sm" className="h-11" disabled={isPending}>
        {isPending ? pendingLabel : label}
      </Button>

      <TenderProblemNotice error={state.error} />
    </form>
  );
}
