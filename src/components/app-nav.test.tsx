import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { BottomNav, TopNav } from "./app-nav";

/**
 * **One source of destinations, two renderings** (ADR-0021, #96).
 *
 * The bottom bar and the top bar are two pieces of markup that must always say the same
 * thing, and that is the honest cost of the split the ADR takes on. Nothing else in the
 * repo can see them disagree: the layout guard runs at 390px, where the top bar is not
 * drawn at all, so a destination added to one bar and not the other would measure clean
 * and ship. This is the check that fails instead.
 *
 * It compares what a reader would actually get from each — the address and the word —
 * rather than the array they are both mapped from, because a shared array proves nothing
 * if one bar stops mapping it.
 */

/** Where each destination goes and what it is called, in the order the bar draws them. */
function destinationsIn(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll("a")].map((link) => [
    link.getAttribute("href") ?? "",
    (link.textContent ?? "").trim(),
  ]);
}

function drawIn(locale: string, messages: typeof en, bar: React.ReactNode): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      {bar}
    </NextIntlClientProvider>,
  );

  return container;
}

describe.each([
  ["en", en],
  ["zh-Hans", zhHans],
])("the two bars, in %s", (locale, messages) => {
  it("name the same destinations, in the same order", () => {
    const top = destinationsIn(drawIn(locale, messages, <TopNav />));
    const bottom = destinationsIn(drawIn(locale, messages, <BottomNav />));

    expect(top).toEqual(bottom);
  });

  it("hold exactly two, and the two ADR-0021 caps the set at", () => {
    expect(destinationsIn(drawIn(locale, messages, <BottomNav />))).toEqual([
      ["/my-work", messages.myWork.title],
      ["/tenders", messages.tenders.title],
    ]);
  });
});
