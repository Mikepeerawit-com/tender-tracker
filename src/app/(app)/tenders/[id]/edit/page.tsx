import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { EditTenderForm } from "@/components/tenders/edit-tender-form";
import { ReferenceImageGallery } from "@/components/tenders/reference-image-gallery";
import { ReferenceImageUploader } from "@/components/tenders/reference-image-uploader";
import {
  AddTenderItemForm,
  EditTenderItemForm,
} from "@/components/tenders/tender-item-forms";
import { currentUser } from "@/lib/auth/session";
import { listReferenceImages } from "@/lib/images/reference-images";
import { listMembers, ownerOptions } from "@/lib/org/members";
import { getTender } from "@/lib/tenders/tenders";

export default async function EditTenderPage({
  params,
}: PageProps<"/tenders/[id]/edit">) {
  const { id } = await params;
  const store = await cookies();
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const tender = await getTender(id, store);

  if (!tender) notFound();

  const t = await getTranslations("tenders");
  const members = await listMembers(store);
  const referenceImages = await listReferenceImages(tender.id, store);

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <span className="text-muted-foreground font-mono text-xs">
            {tender.reference}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("edit")}</h1>
          <p className="text-muted-foreground text-sm">{t("editDescription")}</p>
        </header>

        {/* The Owner this Tender already has, even if they have since been disabled and
            so are not in `members`: a picker that cannot show them reassigns them. */}
        <EditTenderForm
          tenderId={tender.id}
          members={ownerOptions(members, {
            id: tender.ownerUserId,
            name: tender.ownerName,
          })}
          defaults={tender}
        />

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">{t("item.plural")}</h2>
            <p className="text-muted-foreground text-xs">{t("item.hint")}</p>
          </div>

          {tender.items.map((item) => (
            <EditTenderItemForm
              key={item.id}
              tenderId={tender.id}
              item={item}
              // The last Item cannot go: a Tender that asks for nothing is a Tender
              // nobody can Bid on, and the server refuses it either way.
              removable={tender.items.length > 1}
            />
          ))}

          <AddTenderItemForm tenderId={tender.id} />
        </section>

        {/* Buildspec screen 3 puts Reference Images on this screen, and they upload
            per-Tender: five pictures arrive in one email with nothing saying which Item
            each is of, so the placing happens below, against pictures you can see. */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">{t("referenceImages.title")}</h2>

          {/* The hint lives on the input rather than on the heading — one sentence, beside
              the thing it is about. */}
          <ReferenceImageUploader tenderId={tender.id} />

          <ReferenceImageGallery
            tenderId={tender.id}
            images={referenceImages}
            items={tender.items}
          />
        </section>

        {/* Buildspec screen 3 names Assignees alongside the dates and the Items. They
            also sit on the detail page, because that is where somebody who was never
            asked goes to put themselves on a Tender. */}
        <AssigneeControls
          tenderId={tender.id}
          assignees={tender.assignees}
          members={members}
          callerId={user.id}
          isOwner={tender.ownerUserId === user.id}
        />
      </main>
    </div>
  );
}
