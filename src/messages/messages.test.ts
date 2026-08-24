import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultLocale, locales } from "@/i18n/config";
import { selectionProblems } from "@/lib/comparison/sheet";
import { imageProblems } from "@/lib/images/images";
import { quoteProblems } from "@/lib/quotes/quotes";
import { tenderProblems } from "@/lib/tenders/tenders";

/**
 * Both locales are complete at launch, and stay complete.
 *
 * A switcher over half-translated strings sends the first person who flips it to raw
 * message keys — and it does so on their phone, in the language they chose precisely
 * because the other one is hard for them. Nothing at runtime notices: `next-intl`
 * renders the key and carries on.
 *
 * The placeholder check is the second half of the same rule. A translation that drops
 * `{name}` renders happily and silently stops saying whose Tender it is.
 */

type Messages = { [key: string]: string | Messages };

function messages(locale: string): Messages {
  return JSON.parse(
    readFileSync(join(process.cwd(), "src", "messages", `${locale}.json`), "utf8"),
  );
}

/** Every leaf, flattened to `a.b.c` => the message itself. */
function flatten(tree: Messages, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;

    if (typeof value === "string") {
      flat.set(path, value);
    } else {
      for (const [nested, message] of flatten(value, path)) {
        flat.set(nested, message);
      }
    }
  }

  return flat;
}

/** The ICU arguments a message expects, ignoring how it formats them. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)/g)].map((match) => match[1]).sort();
}

const reference = flatten(messages(defaultLocale));
const others = locales.filter((locale) => locale !== defaultLocale);

describe.each(others)("%s", (locale) => {
  const translated = flatten(messages(locale));

  it("translates every key, and invents none", () => {
    expect([...translated.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it("keeps the arguments each message is given", () => {
    const drifted = [...reference]
      .filter(([key, message]) => {
        const other = translated.get(key);

        return other !== undefined && placeholders(other).join() !== placeholders(message).join();
      })
      .map(([key]) => key);

    expect(drifted).toEqual([]);
  });

  it("leaves nothing untranslated by copy-paste", () => {
    // A key whose value is identical in both files is usually one somebody forgot,
    // rather than one that genuinely reads the same in Chinese.
    const identical = [...reference]
      .filter(([key, message]) => translated.get(key) === message)
      .map(([key]) => key)
      .sort();

    expect(identical).toEqual(
      [
        // Both locale names are written in their own language on purpose: someone who
        // cannot read the current one has to be able to find their way out.
        "localeSwitcher.en",
        "localeSwitcher.zh-Hans",
        "chooseLanguage.title",
        "chooseLanguage.option.en",
        "chooseLanguage.option.zh-Hans",
        // A quantity beside its unit, and the × is the whole message.
        "tenders.item.quantified",
        // A URL WeCom issues. Translating it would make it a different address.
        "groupRobot.placeholder",
        // A converted amount behind the mathematical sign for it. There is no word in
        // either language to translate.
        "quotes.approx",
      ].sort(),
    );
  });
});

/**
 * `TenderProblemNotice` renders `tenders.error.<reason>` for whatever the server
 * refused, so a reason added to `TenderProblem` with no message renders as the raw key
 * — in the one place a user is already stuck. The union is derived from this list so
 * that adding a reason and forgetting its wording is a failing test rather than a
 * screen reading `tenders.error.unassignable`.
 */
describe.each(locales)("%s refusals", (locale) => {
  const flat = flatten(messages(locale));

  it("has wording for every reason a write can be refused", () => {
    const missing = tenderProblems.filter((problem) => !flat.has(`tenders.error.${problem}`));

    expect(missing).toEqual([]);
  });

  it("has wording for every reason an image can be refused", () => {
    // Same argument, second union — and one union for Reference Images and Quote Photos
    // alike, because the sentences are the same whoever sent the picture. An upload that
    // fails is the one moment somebody is holding a phone with pictures on it and no
    // idea what to do next.
    const missing = imageProblems.filter(
      (problem) => !flat.has(`images.error.${problem}`),
    );

    expect(missing).toEqual([]);
  });

  it("has wording for every reason a selection can be refused", () => {
    // The shortest of the four unions, and the one whose silence would be worst: a
    // Select button that does nothing leaves the row looking pressed and the person
    // walking away believing the Item is decided.
    const missing = selectionProblems.filter(
      (problem) => !flat.has(`comparison.error.${problem}`),
    );

    expect(missing).toEqual([]);
  });

  it("has wording for every reason a Quote can be refused", () => {
    const missing = quoteProblems.filter(
      (problem) => !flat.has(`quotes.error.${problem}`),
    );

    expect(missing).toEqual([]);
  });
});
