"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { OwnerOption } from "@/lib/org/members";
import type { SubmittedTender } from "@/lib/tenders/tender-form";

/**
 * The Tender's own fields, shared by the record and edit screens so the two cannot
 * drift into asking for different things.
 */
export function TenderFieldInputs({
  members,
  defaults,
}: {
  members: OwnerOption[];
  defaults: SubmittedTender;
}) {
  const t = useTranslations("tenders");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="clientName">{t("client")}</Label>
          <Input
            id="clientName"
            name="clientName"
            defaultValue={defaults.clientName}
            required
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="title">{t("tenderTitle")}</Label>
          <Input
            id="title"
            name="title"
            defaultValue={defaults.title}
            required
            className="h-11"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="dateReceived">{t("dateReceived")}</Label>
          <Input
            id="dateReceived"
            name="dateReceived"
            type="date"
            defaultValue={defaults.dateReceived}
            required
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ownerUserId">{t("owner")}</Label>
          <NativeSelect
            id="ownerUserId"
            name="ownerUserId"
            defaultValue={defaults.ownerUserId}
            required
            className="h-11"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.former ? t("formerMember", { name: member.name }) : member.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="internalQuoteDeadline">{t("internalQuoteDeadline")}</Label>
          <Input
            id="internalQuoteDeadline"
            name="internalQuoteDeadline"
            type="date"
            defaultValue={defaults.internalQuoteDeadline}
            required
            className="h-11"
          />
          <p className="text-muted-foreground text-xs">{t("internalQuoteHint")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="clientSubmissionDeadline">
            {t("clientSubmissionDeadline")}
          </Label>
          <Input
            id="clientSubmissionDeadline"
            name="clientSubmissionDeadline"
            type="date"
            defaultValue={defaults.clientSubmissionDeadline}
            required
            className="h-11"
          />
          <p className="text-muted-foreground text-xs">{t("clientSubmissionHint")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="expectedDecisionDate">{t("expectedDecisionDate")}</Label>
        <Input
          id="expectedDecisionDate"
          name="expectedDecisionDate"
          type="date"
          defaultValue={defaults.expectedDecisionDate}
          className="h-11 sm:max-w-64"
        />
        <p className="text-muted-foreground text-xs">{t("expectedDecisionHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" defaultValue={defaults.notes} rows={3} />
      </div>
    </div>
  );
}
