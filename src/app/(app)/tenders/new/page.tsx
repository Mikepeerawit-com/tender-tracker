import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Screen } from "@/components/screen";
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
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("record")}</h1>
        <p className="text-muted-foreground text-sm">{t("recordDescription")}</p>
      </header>

      {/* The Owner defaults to whoever is recording it — they are the one who has the
          client's email open — and stays changeable in the same breath. */}
      {/* Nothing is owned yet, so there is no former Owner to keep. */}
      <NewTenderForm members={ownerOptions(members, null)} defaultOwnerId={user.id} />
    </Screen>
  );
}
