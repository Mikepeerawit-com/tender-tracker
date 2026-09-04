import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Screen } from "@/components/screen";
import { Measure } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";
import { NewTenderForm } from "@/components/tenders/new-tender-form";
import { currentUser } from "@/lib/auth/session";
import { listMembers, ownerOptions } from "@/lib/org/members";

export default async function NewTenderPage() {
  const store = await cookies();
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const t = await getTranslations("tenders");
  const members = await listMembers(store);

  return (
    <Screen gap="gap-6">
      <ScreenHeader heading={t("record")}>
        <p className="text-muted-foreground text-sm">{t("recordDescription")}</p>
      </ScreenHeader>

      {/* The Owner defaults to whoever is recording it — they are the one who has the
          client's email open — and stays changeable in the same breath. */}
      {/* Nothing is owned yet, so there is no former Owner to keep. */}
      <Measure>
        <NewTenderForm members={ownerOptions(members, null)} defaultOwnerId={user.id} />
      </Measure>
    </Screen>
  );
}
