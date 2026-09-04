import { useTranslations } from "next-intl";

import { MembershipControls } from "@/components/admin/membership-controls";
import { TestMentionButton } from "@/components/admin/test-mention-button";
import { WecomUseridForm } from "@/components/admin/wecom-userid-form";
import type { Membership } from "@/lib/org/members";

/**
 * Who is in this organisation, and the three things an Org Admin does to a Membership:
 * record the WeCom userid the Group Robot @s them by, prove that userid reaches them, and
 * end their access.
 *
 * **A list, so it spans the region** (ADR-0022). Each row is scanned across — a name, an
 * address, two badges and a row of controls — rather than read along, and narrowing it to
 * a line of prose would wrap the controls under the name on a monitor with room for them.
 *
 * Split out of `(app)/admin/people/page.tsx` for the reason `vitest.config.mts` gives for
 * every other such component: the page is an `async` Server Component behind an
 * `isOrgAdmin` gate and no browser test can reach it, so the list nothing measured was the
 * one thing on that screen with rows in it. This is sync and takes only what it draws,
 * which is what lets the shared screen record compose the People screen whole.
 */
export function MembershipList({ members }: { members: Membership[] }) {
  const t = useTranslations("people");

  return (
    <ul className="flex flex-col gap-4">
      {members.map((member) => (
        <li
          key={member.id}
          className="border-border flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{member.name}</span>
            <span className="text-muted-foreground text-sm">{member.email}</span>
            {member.isOrgAdmin ? (
              <span className="bg-muted rounded-md px-2 py-0.5 text-xs">
                {t("orgAdmin")}
              </span>
            ) : null}
            {member.disabledAt ? (
              <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">
                {t("disabled")}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WecomUseridForm userId={member.id} value={member.wecomUserid} />
            <TestMentionButton
              userId={member.id}
              hasUserid={Boolean(member.wecomUserid)}
            />
            {/* Drawn on the admin's own row too. In the org this ships as — one Org
                Admin, because promoting a second is a dashboard `update` — that row is
                where the last-Administrator refusal gets read, and it is the only place
                the app ever explains why an org must keep one. Hiding it would trade a
                mis-click nobody has made for a question nobody can get answered. */}
            <MembershipControls userId={member.id} disabledAt={member.disabledAt} />
          </div>
        </li>
      ))}
    </ul>
  );
}
