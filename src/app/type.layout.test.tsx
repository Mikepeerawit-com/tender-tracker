import { describe, expect, it } from "vitest";

import "@/app/globals.css";

import { familiesIn, fontStack } from "@/test/layout";

/**
 * **The two facts about type that are invisible until they break** (ADR-0019).
 *
 * Both were expensive to reach and neither shows up in a screenshot taken on the machine
 * that has the fonts installed, which is why they are pinned here rather than left to the
 * contact sheet.
 *
 * **No CJK webfont is fetched.** A Han face cannot be subset — there is no 100-glyph
 * slice of a script with tens of thousands of characters — so web-loading one is
 * megabytes over a phone network inside the WeCom webview, on the exact path a Group
 * Robot reminder link takes. The stack is declared in full and drawn by the device.
 *
 * **The `var()` fallbacks are load-bearing.** `next/font` defines the Latin family's
 * variable on the real `html` element and defines it nowhere else — not here, and not in
 * any browser test. A stack whose head were a bare `var(--font-…)` would, without it,
 * substitute nothing, invalidate the whole declaration at computed-value time and fall
 * all the way back to the browser's default serif, taking the CJK half of the stack with
 * it. Naming the family inside the fallback keeps the rest of the stack reachable either
 * way — and this file is exactly the condition that guards, because it renders the app's
 * stylesheet with no `next/font` anywhere near it.
 */

/** ADR-0019's stack, in the order the device is asked to try it. */
const cjkStack = [
  "PingFang SC",
  "Hiragino Sans GB",
  "Source Han Sans SC",
  "Noto Sans SC",
  "Microsoft YaHei",
];

describe("the declared type stack, rendered without next/font", () => {
  it.each([
    ["--font-sans", "the body face"],
    ["--font-mono", "the numeral face"],
  ])("keeps the whole of %s: %s", (token) => {
    const declared = familiesIn(fontStack(token));

    // The head of the stack is the Latin family, named literally inside the `var()`
    // fallback. Without it the declaration is invalid and everything below is gone.
    expect(declared[0]).not.toBe("");
    expect(cjkStack).not.toContain(declared[0]);

    // And the CJK families are all still there, in order, behind it.
    expect(declared.filter((family) => cjkStack.includes(family))).toEqual(cjkStack);
  });

  it("fetches no font file for a CJK family", () => {
    const faces = fontFaces();

    // The check can only fail if there is something to look at, and a harness that
    // loaded no stylesheet at all would report a clean bill of health forever.
    expect(document.styleSheets.length).toBeGreaterThan(0);

    expect(faces.filter((family) => cjkStack.includes(family))).toEqual([]);
  });
});

/** Every family this page has asked a server for a font file for. */
function fontFaces(): string[] {
  return [...document.styleSheets].flatMap((sheet) =>
    [...sheet.cssRules]
      .filter((rule) => rule instanceof CSSFontFaceRule)
      .map((rule) => rule.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "")),
  );
}
