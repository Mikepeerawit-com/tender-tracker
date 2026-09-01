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
 * ICU arguments are named in English out of necessity — `{owner}` is a variable, not a
 * word anybody reads — so they come out before a sentence is read for the words in it.
 *
 * Shared by the two blocks below, both of which decide what a Chinese message is about by
 * reading the English one: `{product}` is no more the English word for the goods than
 * `{owner}` is the English word for the role.
 */
function sentence(message: string): string {
  return message.replace(/\{\s*\w+/g, "{");
}

/**
 * Two roles, two Chinese words, and neither borrowed by the other.
 *
 * 负责人 read as both Owner and Assignee for as long as both roles existed, and that is a
 * translation no single sentence catches you out on: every screen stays fluent, and the
 * reader simply cannot tell which of the two people a sentence is about. The app had
 * already noticed and papered over it — `quotes.error.not_sourced_by_you` ended
 * 负责人（Owner）, glossing one of the two occurrences in English so a Chinese reader
 * could tell them apart. A parenthesis is not a translation; it is a translation
 * admitting it does not have a word.
 *
 * It is load-bearing rather than tidy. ADR-0020 gives an Assignee a different Tender
 * screen from the Owner's, and a split between two roles cannot be explained — in wording,
 * in an error, or in the sentence telling somebody why the sheet is not there — in a
 * language that has one word for both.
 *
 * English is what says which role a message is about. It is the file the strings are
 * written in first, and its two words have never been confused for each other. The two
 * locales are named here rather than taken from `defaultLocale` and `locales`, because
 * these are assertions about two particular languages' words: were English to stop being
 * the default, this would still be the file that decides, and 负责人 would still be
 * Chinese.
 */
describe("the two roles in Chinese", () => {
  const english = flatten(messages("en"));
  const chinese = flatten(messages("zh-Hans"));

  const names = {
    owner: (message: string) => /\bowners?\b/i.test(sentence(message)),
    assignee: (message: string) => /\bassignees?\b/i.test(sentence(message)),
  };

  it("spends 负责人 on the Owner and on nobody else", () => {
    // Goes red on the sentence this ticket started from: the sourcing group's hint said
    // 负责人正在收集价格 for an English line about Assignees getting prices in.
    const misused = [...chinese]
      .filter(([, message]) => message.includes("负责人"))
      .filter(([key]) => !names.owner(english.get(key) ?? ""))
      .map(([key]) => key)
      .sort();

    expect(misused).toEqual([]);
  });

  it("spends 参与人 on the Assignee and on nobody else", () => {
    // The same rule pointed the other way, and not symmetry for its own sake: without it,
    // `tenders.ownedBy` could read 参与人：{name} against English "Owner: {name}" and every
    // other assertion here stays green. That is this ticket's own fault with the roles
    // exchanged, which is the one regression a fix like this actually invites.
    const misused = [...chinese]
      .filter(([, message]) => message.includes("参与人"))
      .filter(([key]) => !names.assignee(english.get(key) ?? ""))
      .map(([key]) => key)
      .sort();

    expect(misused).toEqual([]);
  });

  it("calls an Assignee 参与人 wherever English names one", () => {
    // The two above say a Chinese word is never spent on the wrong role. This says the
    // word is spent at all — a translation that drops the role and says 有人 instead
    // breaks nothing above and loses exactly what this ticket is for.
    //
    // `assignee` and not `assign`: "Colleague to assign" and "Not yet assigned to an item"
    // are about the act, not the person, and Chinese says those with a verb.
    const unnamed = [...english]
      .filter(([, message]) => names.assignee(message))
      .filter(([key]) => !(chinese.get(key) ?? "").includes("参与人"))
      .map(([key]) => key)
      .sort();

    expect(unnamed).toEqual([]);
  });

  it("keeps the two in their own clauses where one message names both", () => {
    // `quotes.error.not_sourced_by_you` is the only message naming both roles, and it is
    // the reason this whole block exists — so it is also the one message every check above
    // is weakest on. Each of them is satisfied by a word appearing *somewhere* in the
    // sentence, which means the two could be swapped for each other and nothing would
    // notice: "only the Owner who sourced this quote, or the Tender's Assignee". That
    // sentence is fluent, is the opposite of the rule it states, and would ship.
    //
    // Order is what tells the two apart, and it is readable here because both languages
    // list the roles in the same order — "the assignee who sourced this, or the tender's
    // owner". A translation that deliberately reordered them would go red and should:
    // whoever did it has to say why the clauses no longer line up.
    const jumbled = [...english]
      .filter(([, message]) => names.owner(message) && names.assignee(message))
      .filter(([key, message]) => {
        const zh = chinese.get(key) ?? "";
        const assignee = zh.indexOf("参与人");
        const owner = zh.indexOf("负责人");

        // Both have to be there before an order means anything — a Chinese sentence that
        // simply dropped the Owner half would otherwise read as correctly ordered.
        if (assignee === -1 || owner === -1) return true;

        const assigneeFirstInChinese = assignee < owner;
        const assigneeFirstInEnglish =
          sentence(message).search(/\bassignees?\b/i) <
          sentence(message).search(/\bowners?\b/i);

        return assigneeFirstInChinese !== assigneeFirstInEnglish;
      })
      .map(([key]) => key)
      .sort();

    expect(jumbled).toEqual([]);
  });

  it("names neither role in English inside a Chinese message", () => {
    // The gloss that existed only because the two roles shared a word. With the words
    // separated there is nothing left for it to disambiguate, and leaving it would invite
    // the next one — a reader who has been shown that Chinese role names need an English
    // footnote will keep expecting it.
    const glossed = [...chinese]
      .filter(([, message]) => names.owner(message) || names.assignee(message))
      .map(([key]) => key)
      .sort();

    expect(glossed).toEqual([]);
  });
});

/**
 * One Chinese word for a Tender, and one for a Tender Item.
 *
 * The Tender answered to 招标, 投标 and 标书; the Tender Item to 招标明细, 条目 and bare
 * 产品. Six words for two things, and not one of them wrong on the screen it appeared on —
 * which is why it survived. A reader met 明细 on the edit screen, 条目 in the picture
 * gallery and 产品项 on the comparison sheet, and was left to work out for themselves that
 * all three are the row they are quoting against. Nothing renders as a key, nothing reads
 * as a mistranslation, and the app is harder to hold in your head for every extra word.
 *
 * 标书 was the worst of the six, and not by degree. It names the bid *document we send
 * back*, so `quotes.error.not_assignee` — 请先把自己加入该标书 — asked somebody to add
 * themselves to our own submission when it meant the client's enquiry. It pointed at the
 * opposite end of the exchange from the thing it named.
 *
 * After this, `CONTEXT.md` reads back off the screen: **Tender is 招标, Tender Item is
 * 产品项**. 投标 survives, but as the act of bidding — a different concept, not a second
 * name for this one — which is what the second assertion is here to hold apart.
 *
 * Three of the words are retired outright rather than only where English names an Item,
 * and that is the lesson of the strings this ticket had to fix by hand. The four
 * `quotes.noSupplier.*` refusals say "you could not source this" in English: they name
 * the row with a pronoun, so a rule keyed on the English word "item" would have had
 * nothing to say about the very sentences that carried the fault. An outright absence has
 * no such blind spot. The cost is that a screen wanting 明细 for something else — a
 * landed-cost breakdown is 成本明细 and is the one use we can foresee — goes red, and
 * whoever writes it amends the check and says which concept the word is naming. That is
 * the trade this repo wants: a check somebody must consciously argue past, over one that
 * is quiet about the strings most likely to go wrong.
 *
 * English still decides for the two words that stay in use, for the reason it does one
 * block above: it is where the strings are written first, and it has never used one word
 * for two concepts here. `\bitems?\b` and `\bproducts?\b` are what separate the row from
 * the goods, and English keeps them apart even in the one message that names both — "A
 * tender asks for at least one product. Add an item."
 *
 * **There is deliberately no check that Chinese says 产品项 everywhere English says
 * "item",** which is the mirror of the third assertion one block above and would be wrong
 * here. Chinese counts with a classifier: `tenders.item.numbered` is 第 {number} 项 and
 * `tenders.row.unsourced` is {total} 项中有 {count} 项尚未询价. That 项 is grammar, not a
 * seventh name for the concept, and a check demanding the noun in front of it would be
 * demanding worse Chinese in the name of consistency. The one place it *is* demanded is
 * the last assertion, where a message names the row and the goods both and the bare word
 * cannot be told which of them it is doing.
 */
describe("one word for a Tender, one for its Items, in Chinese", () => {
  const english = flatten(messages("en"));
  const chinese = flatten(messages("zh-Hans"));

  const names = {
    item: (message: string) => /\bitems?\b/i.test(sentence(message)),
    product: (message: string) => /\bproducts?\b/i.test(sentence(message)),
    // `submi` rather than a whole word: the English says "bid", "submitted" and
    // "submission" for the one act, and it is the act that licenses the word.
    bid: (message: string) => /\bbids?\b|submi/i.test(sentence(message)),
  };

  /**
   * Every key whose Chinese still says a word, for the assertions that retire one.
   *
   * Returned whole and sorted rather than counted, so a failure names the strings to go
   * and read — the fault is always in a particular sentence, never in a total.
   */
  function saying(word: string): string[] {
    return [...chinese]
      .filter(([, message]) => message.includes(word))
      .map(([key]) => key)
      .sort();
  }

  /** The same, for a word that keeps a use: where its English does not license it. */
  function unlicensed(word: RegExp, licence: (english: string) => boolean): string[] {
    return [...chinese]
      .filter(([, message]) => word.test(message))
      .filter(([key]) => !licence(english.get(key) ?? ""))
      .map(([key]) => key)
      .sort();
  }

  it("has no 标书 left to name the client's enquiry, or anything else", () => {
    // The Bid document, which this app has never had a screen for: every one of the five
    // occurrences was the Tender wearing the name of the thing we send back.
    expect(saying("标书")).toEqual([]);
  });

  it("has no 条目 left to name a Tender Item", () => {
    // Four, all in the reference-image gallery, which was the only screen calling the row
    // this — so the gallery was the one place a reader had to guess that the thing a
    // picture is "of" is the thing they are quoting against.
    expect(saying("条目")).toEqual([]);
  });

  it("has no 明细 left to name a Tender Item", () => {
    // Seventeen, and the widest-travelled of the three: the edit screen, the worklist
    // hints, five validation errors and every outcome sentence.
    expect(saying("明细")).toEqual([]);
  });

  it("spends 投标 on the act of bidding and never on the client's enquiry", () => {
    // The one neighbouring word that is not retired — 投标 is right in all eighteen places
    // it stands, and this is what stops it drifting back into the nineteenth. Goes red on
    // 本次投标的负责人 for "the tender's owner", which is the substitution a reader who has
    // just been told 标书 is wrong will reach for next.
    expect(unlicensed(/投标/, names.bid)).toEqual([]);
  });

  it("spends bare 产品 on the goods and 产品项 on the row", () => {
    // The subtlest of the five, because 产品项 contains 产品 — the lookahead is what makes
    // this a check on the bare word rather than one that passes on every string it is
    // pointed at. Goes red on `tenders.sourcing.source` (为该产品询价 for "Source this
    // item") and on the four `quotes.noSupplier.*` refusals, which recorded a supplier
    // that could not be found for a *product* when what they are filed against is a row.
    expect(unlicensed(/产品(?!项)/, names.product)).toEqual([]);
  });

  it("names the row too, in the one message that is about both", () => {
    // The licence above is granted per message, and a message can be about two things.
    // `tenders.error.no_items` — "A tender asks for at least one product. Add an item." —
    // names the goods in English and so may keep its 产品, which leaves the check above
    // blind on exactly the half of that sentence this ticket is for: 请添加产品 for "Add
    // an item" names the row with the bare word and stays green.
    //
    // So where English names both, the Chinese has to name both too. It is the narrowest
    // form of the "wherever English says item" rule that the block comment rules out in
    // general, and it is safe here for the reason the general form is not: a sentence
    // already using 产品 for the goods cannot fall back on the bare classifier for the
    // row without saying the same word twice for two things.
    const rowUnnamed = [...english]
      .filter(([, message]) => names.item(message) && names.product(message))
      .filter(([key]) => !(chinese.get(key) ?? "").includes("产品项"))
      .map(([key]) => key)
      .sort();

    expect(rowUnnamed).toEqual([]);
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
