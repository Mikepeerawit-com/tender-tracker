import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultLocale, locales } from "@/i18n/config";
import { loginErrors } from "@/lib/auth/session";
import { setPasswordErrors } from "@/lib/auth/password";
import { setupErrors } from "@/lib/auth/setup";
import { inviteStatuses, wecomUserIdStatuses } from "@/lib/auth/invite";
import { pricingProblems, selectionProblems } from "@/lib/comparison/sheet";
import { imageProblems } from "@/lib/images/images";
import { matchTypes, quoteProblems } from "@/lib/quotes/quotes";
import { tenderOutcomes } from "@/lib/tenders/outcome";
import { groupRobotStatuses } from "@/lib/wecom/group-robot";
import { testMentionStatuses } from "@/lib/wecom/test-mention";
import {
  deadlineKinds,
  tenderProgresses,
  worklistGroups,
} from "@/lib/tenders/progress";
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
        // The same names again, shortened for the app bar (#56). Same reason: the way out
        // of a language you cannot read has to be legible from inside it.
        "localeSwitcher.short.en",
        "localeSwitcher.short.zh-Hans",
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
 *
 * The same argument covers every other union the app renders a key from — the worklist's
 * groups, Progress, and which deadline a row is due on. Each is walked rather than
 * listed, so a value added to one of them cannot ship without a sentence.
 */
describe.each(locales)("%s wording", (locale) => {
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

  it("has wording for every reason a price can be refused", () => {
    // The prices are typed straight into the Item's row, with no page of their own to
    // land an error on. A refusal with no wording is a figure that silently stays as it
    // was while somebody watches themselves type a new one.
    const missing = pricingProblems.filter(
      (problem) => !flat.has(`comparison.pricing.error.${problem}`),
    );

    expect(missing).toEqual([]);
  });

  it("names every group of the worklist, and says what it means", () => {
    // The list is the app's home, and a group whose title renders as
    // `tenders.group.sourcing.title` is a heading nobody can act on. The union is walked
    // rather than the keys listed, so a sixth group cannot ship unnamed — which is the
    // whole of what changed here when the five blocks became Progress plus the one
    // pinned exception.
    const missing = worklistGroups.flatMap((group) =>
      ["title", "hint"]
        .map((part) => `tenders.group.${group}.${part}`)
        .filter((key) => !flat.has(key)),
    );

    expect(missing).toEqual([]);
  });

  it("has a word for every Progress a Tender can read as", () => {
    const missing = tenderProgresses.filter(
      (progress) => !flat.has(`tenders.progress.${progress}`),
    );

    expect(missing).toEqual([]);
  });

  it("says which deadline a row is counting down to, and how far off it is", () => {
    // Either deadline can be the next one, and a row that does not say which is one the
    // reader has to open the Tender to act on. Each kind needs all four readings: the
    // day itself, tomorrow, a date further out, and one already gone by.
    const missing = deadlineKinds.flatMap((kind) =>
      ["today", "tomorrow", "on", "passed"]
        .map((when) => `tenders.row.due.${kind}.${when}`)
        .filter((key) => !flat.has(key)),
    );

    expect(missing).toEqual([]);
  });

  it("has wording for every reason a Quote can be refused", () => {
    const missing = quoteProblems.filter(
      (problem) => !flat.has(`quotes.error.${problem}`),
    );

    expect(missing).toEqual([]);
  });

  it("says why somebody was not let in", () => {
    // The one screen where a raw key cannot be worked around: whoever is reading it is
    // outside the app, and the sentence explaining why is the only instruction they get.
    // `link` is in the list and comes from no action — an expired invite link lands on
    // the login as a flag on the URL, which is exactly the arrival most likely to need
    // the wording.
    const missing = loginErrors.filter((error) => !flat.has(`login.error.${error}`));

    expect(missing).toEqual([]);
  });

  it("says why a password was not accepted", () => {
    // Refused at the one moment the account does not exist yet. Somebody who cannot read
    // why has no signed-in app to retreat into and no password to get back in with.
    const missing = setPasswordErrors.filter(
      (error) => !flat.has(`setPassword.error.${error}`),
    );

    expect(missing).toEqual([]);
  });

  it("says why the first Org Admin was not created", () => {
    // The screen with the least behind it: no session, no account anywhere in the
    // database, and no Org Admin to ask. Whoever is reading a refusal here is the person
    // standing up the deployment, and a raw key leaves them with a form and no idea which
    // of the two guards turned them away.
    const missing = setupErrors.filter((error) => !flat.has(`setup.error.${error}`));

    expect(missing).toEqual([]);
  });

  it("reports how every invitation ended", () => {
    // Success and refusal walk the same list on purpose. An invite whose outcome renders
    // as a key leaves the Org Admin unable to tell a sent invitation from a silent
    // failure, and the person waiting for it has no way to ask.
    const missing = inviteStatuses.filter(
      (status) => !flat.has(`people.invite.status.${status}`),
    );

    expect(missing).toEqual([]);
  });

  it("reports how every WeCom userid save ended", () => {
    const missing = wecomUserIdStatuses.filter(
      (status) => !flat.has(`people.wecom.status.${status}`),
    );

    expect(missing).toEqual([]);
  });

  it("reports how every test mention ended", () => {
    // The wording here is load-bearing beyond legibility: `errcode 0` means accepted and
    // never notified, so this status is the only thing standing between the Org Admin and
    // believing a mention was delivered. `conventions.test.ts` holds the success string to
    // its promise; this holds every status to having one at all.
    const missing = testMentionStatuses.filter(
      (status) => !flat.has(`people.wecom.test.status.${status}`),
    );

    expect(missing).toEqual([]);
  });

  it("reports how every group robot save ended", () => {
    const missing = groupRobotStatuses.filter(
      (status) => !flat.has(`groupRobot.status.${status}`),
    );

    expect(missing).toEqual([]);
  });

  it("names both ways a Quote can answer the Item", () => {
    // Exact and Alternative are radio labels, and a radio labelled
    // `quotes.matchType.alternative` is one nobody can choose deliberately — which turns
    // the one field that tells a reviewer they are being offered a different product into
    // a guess.
    const missing = matchTypes.filter((match) => !flat.has(`quotes.matchType.${match}`));

    expect(missing).toEqual([]);
  });

  it("names every Outcome a Tender can read as, and explains it", () => {
    // `partial` is the reason this walks a list of its own rather than reusing the Items'
    // one: it is the only Outcome no Item can hold, so a union built from `itemOutcomes`
    // alone would pass while the mixed result — the single most confusing thing the bar
    // ever says — rendered as its key.
    const missing = tenderOutcomes.flatMap((outcome) =>
      ["value", "explain"]
        .map((part) => `tenders.outcome.${part}.${outcome}`)
        .filter((key) => !flat.has(key)),
    );

    expect(missing).toEqual([]);
  });

  it("offers every locale by name on the first-run choice", () => {
    // Written in its own language, so this is the one screen whose wording cannot be read
    // by falling back to the other locale. A third locale added without its own name here
    // would be an option nobody who needs it can identify.
    const missing = locales.flatMap((locale) =>
      [`chooseLanguage.option.${locale}`, `localeSwitcher.${locale}`].filter(
        (key) => !flat.has(key),
      ),
    );

    expect(missing).toEqual([]);
  });
});

/**
 * Every key written as a literal in the source resolves to a message.
 *
 * The tests above walk the unions the app builds keys from at runtime. This walks the
 * other half — the several hundred keys typed out by hand — and it is the half where the
 * mistake is a typo rather than an omission. `next-intl` renders an unresolved key as
 * itself and reports nothing: no throw, no console line, no failing render. The screen
 * simply reads `tenders.sourcing.bidTotl` and every automated test in this repo stays
 * green, because none of them assert on wording.
 *
 * Read out of the source rather than asserted screen by screen, because the point is
 * coverage: a screen nobody wrote a test for is exactly the screen this is here to catch.
 */
describe("keys written into the source", () => {
  const sourceRoot = join(process.cwd(), "src");

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) return sourceFiles(path);
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) return [path];

      return [];
    });
  }

  /**
   * Brace depth at every character, which is what tells a binding from a sibling's.
   *
   * Several components here declare `t` more than once — `working-sheet.tsx` binds it to
   * six namespaces in six components in one file. Taking the nearest declaration above a
   * call is not enough: the nearest one may belong to a function that has already closed,
   * which would check most of that file against the wrong namespace and report a wall of
   * keys that are all perfectly fine.
   */
  function depths(source: string): number[] {
    const depth = new Array<number>(source.length);
    let level = 0;

    for (let index = 0; index < source.length; index++) {
      if (source[index] === "}") level--;
      depth[index] = level;
      if (source[index] === "{") level++;
    }

    return depth;
  }

  type Binding = { name: string; namespace: string; at: number };

  function bindings(source: string): Binding[] {
    return [
      ...source.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)")?\s*\)/g,
      ),
    ].map((match) => ({ name: match[1], namespace: match[2] ?? "", at: match.index }));
  }

  /**
   * The namespace a translator *received as a prop* carries, read off its type.
   *
   * `tenders/page.tsx` hands `t` down to `TenderRow` rather than binding a second one, so
   * those calls have no declaration in scope at all. The annotation is what says which
   * namespace they are in — guessing from the enclosing file would be right today only
   * because the parent happens to share it.
   */
  function annotated(source: string, name: string): string | undefined {
    return new RegExp(
      `\\b${name}\\s*:[^;,\\n]*?(?:useTranslations|getTranslations)<"([^"]*)">`,
    ).exec(source)?.[1];
  }

  /**
   * The literal `t("…")` calls in a file, paired with the namespace in force at each.
   *
   * `t.has(…)` is deliberately not among the call forms matched: it is next-intl's
   * existence check, the idiom for a message that is *optional*. Requiring those keys
   * would invert what the guard around them is for.
   */
  function literalKeys(source: string): string[] {
    const declared = bindings(source);
    const depth = depths(source);
    const names = [...new Set(declared.map((binding) => binding.name))];

    return names.flatMap((name) => {
      const calls = source.matchAll(
        new RegExp(`\\b${name}(?:\\.rich|\\.markup|\\.raw)?\\(\\s*"([^"]*)"`, "g"),
      );

      return [...calls].flatMap((call) => {
        const inScope = declared.filter(
          (binding) =>
            binding.name === name &&
            binding.at < call.index &&
            // Never dips below the binding's own depth on the way to the call, which is
            // what rules out a binding whose function has already closed.
            Math.min(...depth.slice(binding.at, call.index)) >= depth[binding.at],
        );

        const namespace = inScope.at(-1)?.namespace ?? annotated(source, name);

        // A translator that arrives from somewhere else and says nothing about which
        // namespace it is in cannot be checked. Skipped rather than guessed at.
        if (namespace === undefined) return [];

        return [namespace === "" ? call[1] : `${namespace}.${call[1]}`];
      });
    });
  }

  const used = [
    ...new Set(
      sourceFiles(sourceRoot).flatMap((path) => literalKeys(readFileSync(path, "utf8"))),
    ),
  ].sort();

  it("finds keys to check at all", () => {
    // The scan is a regex over source, so it fails open: a refactor that renamed the
    // hooks or changed how they are called would quietly check nothing and pass. The
    // count only has to be large enough to prove it is still reading the app.
    expect(used.length).toBeGreaterThan(100);
  });

  it("reads the keys a translator passed as a prop renders", () => {
    // The one case with no binding in scope, and the one most easily skipped silently.
    // Named here so that losing it is a failure rather than a quieter suite.
    expect(used).toContain("tenders.ownedBy");
  });

  it.each(locales)("resolves every one of them in %s", (locale) => {
    const flat = flatten(messages(locale));

    expect(used.filter((key) => !flat.has(key))).toEqual([]);
  });
});
