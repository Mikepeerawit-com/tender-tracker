import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { InviteForm } from "@/components/admin/invite-form";
import { MembershipList } from "@/components/admin/membership-list";
import { Screen } from "@/components/screen";
import { Measure } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { listMemberships } from "@/lib/org/members";

/**
 * The only administrative screen in v1: who is in the org, inviting someone new, and
 * the WeCom userid the group robot needs to @mention them.
 *
 * Hidden from non-admins with `notFound()` rather than a redirect, because a page that
 * announces "you are not allowed here" also announces that here exists. The real gate
 * is in the server actions — this only decides what gets drawn.
 */
export default async function PeoplePage() {
  const store = await cookies();
  const user = await currentUser(store);

  if (!user?.isOrgAdmin) notFound();

  const t = await getTranslations("people");

  // Read through `listMemberships` rather than issued here: this page cannot be called by
  // any test, so a query written in it — and the ordering rule it carries — is
  // unreviewable (#119).
  const members = await listMemberships(store);

  return (
    <Screen measure="42rem">
      <ScreenHeader heading={t("title")}>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </ScreenHeader>

      <Measure>
        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{t("invite.title")}</h2>
          <InviteForm />
        </section>
      </Measure>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("members")}</h2>
        <MembershipList members={members} />
      </section>
    </Screen>
  );
}
