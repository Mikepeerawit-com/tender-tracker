import { render } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import { commands, page, server } from "vitest/browser";

import {
  locales,
  Screen,
  screens,
  signedOutScreens,
  SignedOut,
  type Theme,
  themes,
} from "@/test/screens";
import { phone } from "@/test/layout";
import { captureWindow } from "@/test/phone.mjs";

/**
 * **The contact sheet** — every screen, both locales and both themes, photographed for
 * somebody to look at (#78, #135).
 *
 * This is deliberately **not a check**. It asserts nothing about how anything looks, it
 * has no baseline to diff against, and it never runs in CI. ADR-0016 refuses checks that
 * cannot fail because they manufacture confidence; this manufactures none, because it
 * never reports green about the thing it draws. It is a review surface, like a diff.
 *
 * It runs from `npm run contact-sheet`, on the machine of whoever wants to look, and is
 * excluded from `npm test` by the project filter in `package.json`.
 *
 * **Why not in CI.** Under ADR-0019 the CJK face is drawn by the device with no webfont,
 * so a screenshot of this app is a fact about the machine that took it. A Linux runner
 * resolves at best Noto Sans SC and may carry no CJK face at all, which would render
 * `zh-Hans` — the locale #68 says to judge first — as a wall of tofu. macOS resolves
 * PingFang SC, the head of ADR-0019's stack and what an iPhone reader actually sees. So
 * the honest capture is a local one, and #80 already set the shape: a check CI cannot
 * truthfully perform becomes a script a human runs.
 *
 * The sheet says which faces really resolved, because that is the one fact that makes an
 * image from one machine safe to read on another.
 *
 * **Both themes since #135**, and the pair is laid out side by side rather than on two
 * pages. `contrast.layout.test.tsx` can say that every word on the dark ground clears its
 * floor and cannot say whether the screen is any *good* — whether the washes still read as
 * surfaces, whether a chip still reads as a chip. And it is the only place #129's first
 * open risk can be judged at all: in `zh-Hans` a gain and a passed deadline are both red,
 * a few centimetres apart on the Tender detail, and whether the tabular figure with a
 * triangle reads differently enough from the sentence beside a lamp is a question for eyes
 * rather than for a ratio.
 */

/**
 * The capture instant, resolved once by the `contact-sheet` script and handed in.
 *
 * ADR-0010 bans a bare `new Date()` anywhere under `src/` and says why: the instant is
 * read once at the boundary and passed down, never reached for in the middle. A capture
 * run has a boundary too — it is the command line — so the shape is the same one, and
 * this file gets the answer rather than asking the clock.
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_CONTACT_SHEET_AT?: string;
  }
}

const CAPTURED_AT = import.meta.env.VITE_CONTACT_SHEET_AT ?? "an unrecorded time";

/**
 * Where the sheet is written, gitignored.
 *
 * Two constants for one directory, because the two APIs disagree about what a relative
 * path is relative to: `page.screenshot` resolves against **this file**, and
 * `commands.writeFile` against the **project root**. Getting that wrong writes outside
 * the repo, which is how this was found.
 */
const OUT_FROM_HERE = "../../.contact-sheet";
const OUT_FROM_ROOT = ".contact-sheet";

type Shot = { screen: string; locale: string; theme: Theme; file: string };

const shots: Shot[] = [];

/** What actually drew the type, filled in on the first capture. */
let faces: ResolvedFace[] = [];

describe("the contact sheet", () => {
  it.each(
    locales.flatMap(([locale, messages]) =>
      themes.flatMap((theme) =>
        Object.entries(screens(messages)).map(
          ([name, entry]) =>
            [`${name}, in ${locale}, ${theme}`, name, locale, theme, messages, entry.body] as const,
        ),
      ),
    ),
  )("captures %s", async (_case, name, locale, theme, messages, body) => {
    render(
      <Screen theme={theme} locale={locale} messages={messages}>
        {body}
      </Screen>,
    );

    if (faces.length === 0) faces = resolveDeclaredStack();

    await photograph(name, locale, theme);
  });

  /**
   * And the four reached before signing in. They are photographed here rather than left
   * out because the sheet's claim is *every screen*, and the first screen anybody in this
   * org will ever see is one of these — on a phone, at night, in the theme this ticket is
   * about.
   */
  it.each(
    locales.flatMap(([locale, messages]) =>
      themes.flatMap((theme) =>
        Object.entries(signedOutScreens(messages)).map(
          ([name, entry]) =>
            [`${name}, in ${locale}, ${theme}`, name, locale, theme, messages, entry.body] as const,
        ),
      ),
    ),
  )("captures %s", async (_case, name, locale, theme, messages, body) => {
    render(
      <SignedOut theme={theme} locale={locale} messages={messages}>
        {body}
      </SignedOut>,
    );

    await photograph(name, locale, theme);
  });

  afterAll(async () => {
    // A run that captured nothing would otherwise write a cheerful empty page.
    expect(shots.length).toBeGreaterThan(0);

    await commands.writeFile(`${OUT_FROM_ROOT}/index.html`, indexPage(shots, faces));
  });
});

/**
 * Take the picture of whatever was just rendered, and record it in the sheet.
 *
 * Both `it.each` blocks above do this and only this once their screen is on the page, and
 * the difference between them is which wrapper composed it — so the composing is theirs
 * and everything after it is here.
 */
async function photograph(name: string, locale: string, theme: Theme): Promise<void> {
  const file = `${slug(name)}.${locale}.${theme}.png`;

  // Lay the screen out at phone size first — the previous capture left the iframe as tall
  // as its own screen, and a page laid out in that taller box measures wrong here.
  await page.viewport(phone.width, phone.height);

  // Then grow the viewport to the screen's full height before photographing it. Both
  // halves are needed and neither implies the other: screenshotting `document.body` alone
  // returns a box the right size with everything below the fold unpainted, and growing
  // the viewport alone still needs an element to bound the capture.
  const height = fullHeight();

  // Taller than the window and vitest would quietly scale the iframe to fit, producing a
  // sheet that looks fine and is the wrong size. Fail instead: this asserts the tool
  // worked, never that the screen looks right.
  expect(height, `${name} is taller than the capture window`).toBeLessThanOrEqual(
    captureWindow.height,
  );

  await page.viewport(phone.width, height);

  await page.screenshot({ element: document.body, path: `${OUT_FROM_HERE}/${file}` });

  shots.push({ screen: name, locale, theme, file });
}

/**
 * Which of the families the app *declares* actually got used.
 *
 * Read off `--font-sans` rather than hardcoded, so the sheet cannot claim a stack the
 * stylesheet no longer has. Availability is measured, not asked for: a family that is not
 * installed falls through to the same last-resort face as a deliberately bogus name, so
 * an identical advance width means it did not resolve.
 *
 * The Latin face matters most here. `--font-fira-sans` is set by `next/font` on the real
 * `<html>` and is absent in this harness, so unless Fira Sans is installed locally the
 * Latin text in these images is being drawn by the CJK face behind it. That is a real
 * difference from production and the reader has to be told, not spared.
 */
type FaceRole = "drew this sheet" | "never reached" | "not installed";
type ResolvedFace = { family: string; role: FaceRole };

/** CSS keywords, not faces: nothing to probe, and they always resolve to something. */
const GENERIC = new Set([
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
]);

function resolveDeclaredStack(): ResolvedFace[] {
  const declared = getComputedStyle(document.body)
    .fontFamily.split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter((family) => family !== "");

  // A generic keyword always resolves, so the walk below stops there if it gets that far.
  const resolves = declared.map(
    (family) => GENERIC.has(family.toLowerCase()) || canDraw(family),
  );

  // Only the first family that resolves draws anything. Everything after it is declared
  // and never consulted, which is a different fact from being absent, and the reader
  // needs them told apart to know what they are looking at.
  const winner = resolves.indexOf(true);

  return declared.map((family, index) => ({
    family,
    role:
      index === winner
        ? "drew this sheet"
        : resolves[index]
          ? "never reached"
          : "not installed",
  }));
}

/** Han and Latin both, because a CJK face can carry one and not the other. */
const SAMPLE = "尚未开始 Sourcing 1,240.50";

/**
 * Whether a named family is really installed, measured rather than asked for.
 *
 * A family the machine does not have falls through to the same last-resort face as a name
 * nothing can match, so an identical advance width means it did not resolve. There is no
 * API that answers this directly — `document.fonts.check` reports on loaded webfonts, and
 * these are the device's own.
 */
function canDraw(family: string): boolean {
  const context = document.createElement("canvas").getContext("2d");

  if (context === null) return false;

  const missing = "__no_such_family__";

  context.font = `24px "${missing}"`;
  const fallback = context.measureText(SAMPLE).width;

  context.font = `24px "${family}", "${missing}"`;

  return context.measureText(SAMPLE).width !== fallback;
}

/** How tall this screen really is, however it chose to lay itself out. */
function fullHeight(): number {
  return Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
    phone.height,
  );
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/**
 * One page, each screen a row of four: both locales, and inside each the two themes.
 *
 * `zh-Hans` is drawn first for the reason #68 gives — judge the working language first,
 * because the type scale was set for PingFang and checked against the Latin face rather
 * than the other way round — and the themes sit **adjacent within a locale** rather than
 * on two pages, because what somebody is looking for here is the difference between them
 * on one screen. A dark palette reviewed on its own reads as fine; reviewed beside the
 * light one, the wash that went flat and the chip that stopped being a chip are obvious.
 */
const cells = locales.flatMap(([locale]) =>
  themes.map((theme) => ({ locale, theme })),
);

function indexPage(taken: Shot[], resolved: ResolvedFace[]): string {
  const order = [...new Set(taken.map((shot) => shot.screen))];

  const rows = order
    .map((name) => {
      const row = cells
        .map(({ locale, theme }) => {
          const shot = taken.find(
            (s) => s.screen === name && s.locale === locale && s.theme === theme,
          );

          if (shot === undefined) {
            return `<figure><figcaption>${locale} · ${theme} — not captured</figcaption></figure>`;
          }

          return `<figure>
        <figcaption>${locale} · ${theme}</figcaption>
        <a href="${shot.file}"><img src="${shot.file}" alt="${name}, ${locale}, ${theme}"></a>
      </figure>`;
        })
        .join("\n      ");

      return `  <section>
    <h2>${name}</h2>
    <div class="pair">
      ${row}
    </div>
  </section>`;
    })
    .join("\n");

  const faceList = resolved
    .map(
      (face) =>
        `<li class="${face.role === "drew this sheet" ? "yes" : "no"}">${face.family} — ${face.role}</li>`,
    )
    .join("\n      ");

  return `<!doctype html>
<meta charset="utf-8">
<title>Contact sheet — tender-tracker</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem; max-width: 1500px; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .note { color: #666; max-width: 62ch; }
  .facts { background: #f4f4f5; border-radius: 8px; padding: 1rem 1.25rem; margin: 1.5rem 0 2.5rem; }
  @media (prefers-color-scheme: dark) { .facts { background: #1c1c1f; } .note { color: #9a9aa2; } }
  .facts ul { margin: .5rem 0 0; padding-left: 1.1rem; }
  .yes { font-weight: 600; }
  .no { opacity: .6; }
  section { margin-bottom: 3rem; }
  h2 { font-size: 1rem; margin: 0 0 .75rem; }
  .pair { display: flex; gap: 1.25rem; align-items: flex-start; }
  figure { margin: 0; flex: 1; min-width: 0; }
  figcaption { font-size: .8rem; color: #666; margin-bottom: .4rem; }
  img { width: 100%; height: auto; border: 1px solid #d4d4d8; border-radius: 6px; display: block; }
</style>

<h1>Contact sheet</h1>
<p class="note">
  Every screen, both locales and both themes, as this machine drew them. This is something
  to look at, not a check — there is no baseline, nothing is committed, and nothing here
  can fail. The
  phone in your hand is still the only honest renderer; see
  <code>scripts/prelaunch-phone-checks.sh</code>.
</p>

<div class="facts">
  <div><strong>Captured</strong> ${CAPTURED_AT} · ${server.platform} · ${server.browser} · ${phone.width}×${phone.height}</div>
  <div style="margin-top:.75rem"><strong>Faces declared by <code>--font-sans</code>, and what resolved:</strong></div>
  <ul>
      ${faceList}
  </ul>
  <p class="note" style="margin-bottom:0">
    Only the first family that resolves draws anything; the rest are declared and never
    consulted. <code>next/font</code> supplies <code>Fira Sans</code> in the real app
    and not in this harness, so unless it is installed here the Latin text below is being
    drawn by the CJK face behind it — a real difference from what ships.
  </p>
</div>

${rows}
`;
}
