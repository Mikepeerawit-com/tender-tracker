import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it } from "vitest";

import "@/app/globals.css";

import type { WorklistRow } from "@/lib/tenders/worklist";
import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";
import { expectNoSidewaysScroll, phone } from "@/test/layout";

import { TenderRow } from "./tender-row";

/**
 * The tender list at the width #56 was reported at.
 *
 * The list is the app's home and had never been measured: `TendersPage` is an `async`
 * Server Component and the row was a private function inside it, so nothing could reach
 * it. The row is a component now for exactly this reason.
 *
 * Two fixtures, and the second is the point. A tidy row proves the ordinary case; the
 * awkward one is what pushes a layout over, and on this screen the awkward one is not
 * exotic — a client name is whatever the client is called, a reference is whatever the
 * client numbered it, and neither has to contain a space.
 *
 * Both locales, because the row's own chips are translated — the progress label and the
 * two deadline sentences — and #56 is explicit that *"the labels are translated, so
 * English is not the worst case"*.
 */
const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

describe(`a tender row at ${phone.width}×${phone.height}`, () => {
  it.each(
    locales.flatMap(([locale, messages]) =>
      [
        ["an ordinary row", ordinary],
        ["a client whose name and reference have nowhere to wrap", unbroken],
        ["a row whose sourcing is overdue, so the lamp is lit", overdue],
        ["a row whose submission was missed, the longest sentence there is", dead],
        ["a row whose Bid is with the client, which dates an instant", awaiting],
      ].map(
        ([who, tender]) =>
          [`${who}, in ${locale}`, locale, messages, tender as WorklistRow] as const,
      ),
    ),
  )("does not push the page sideways: %s", (_case, locale, messages, tender) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        {/* The page's own wrapper, so the row is measured inside the padding it really
            has rather than edge to edge. */}
        <div className="flex flex-1 flex-col gap-8 p-6">
          <main className="mx-auto flex w-full max-w-7xl flex-col gap-8">
            {/* The bordered container the group draws its rows inside. */}
            <div className="border-hairline bg-card overflow-hidden rounded-lg border">
              <ul className="flex flex-col">
                <li>
                  <TenderRow tender={tender} timezone="Asia/Bangkok" />
                </li>
              </ul>
            </div>
          </main>
        </div>
      </NextIntlClientProvider>,
    );

    expectNoSidewaysScroll();
  });
});

const base = {
  clientName: "",
  title: "",
  reference: "",
  ownerName: "",
  id: "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90",
  dateReceived: "2026-08-01",
  internalQuoteDeadline: "2026-08-20",
  clientSubmissionDeadline: "2026-08-28",
  expectedDecisionDate: null,
  ownerUserId: "user-somchai",
  notes: null,
  submittedAt: null,
  itemCount: 12,
  progress: "sourcing",
  dueDeadlines: ["internal_quote"],
  status: { kind: "due", tone: "signal", deadline: "internal_quote", days: 1 },
  notYetSourced: 0,
  assigneeUserIds: [],
} satisfies WorklistRow;

const ordinary: WorklistRow = {
  ...base,
  reference: "TR-2026-0142",
  clientName: "Bangkok Metropolitan Administration",
  title: "Medical consumables, Q3 2026",
  ownerName: "Somchai P.",
};

/**
 * Nothing here is invented for the test. Thai hospital procurement references really do
 * run this long without a break, and a department's full name is one token more often
 * than not.
 */
const unbroken: WorklistRow = {
  ...base,
  reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
  clientName: "ChulalongkornMemorialHospitalProcurementDepartment",
  title: "NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
  ownerName: "Somchai Prasertkul",
};

/**
 * The two lit readings, on the unbroken fixture rather than the tidy one.
 *
 * The lamp and the sentence are what #71 added to this row, and they are added to the
 * line that was already the tightest — a reference and a client name with nowhere to
 * wrap. A sentence that fits beside a short name proves nothing about the row that
 * actually overflows.
 */
const overdue: WorklistRow = {
  ...unbroken,
  status: { kind: "unsourced", tone: "alarm", count: 11, total: 12 },
  notYetSourced: 11,
  dueDeadlines: [],
};

/** The Bid is out, so the row dates the day it went rather than a spent deadline. */
const awaiting: WorklistRow = {
  ...unbroken,
  progress: "submitted",
  submittedAt: "2026-08-19T16:30:00Z",
  status: { kind: "awaiting_decision", tone: "calm" },
  dueDeadlines: [],
};

const dead: WorklistRow = {
  ...unbroken,
  progress: "new",
  status: { kind: "submission_missed", tone: "alarm", days: 128 },
  dueDeadlines: [],
};
