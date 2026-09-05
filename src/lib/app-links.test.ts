import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { appLinks, appOrigin, linksFor } from "./app-links";

/**
 * The app's own address, and the three places a group message can send somebody.
 *
 * `APP_ORIGIN` is the one environment variable in this repo that is read for its *value*
 * rather than handed to a client library, so the validation is the interesting half: a
 * string nobody checked is concatenated into a URL that is posted, unretractably, into a
 * company WeCom group. Every rejection below is a string somebody plausibly pastes into
 * a Vercel settings field.
 */

const origin = "https://tenders.example.com";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reading the app's origin from the environment", () => {
  it("takes an absolute https origin as it is", () => {
    vi.stubEnv("APP_ORIGIN", origin);

    expect(appOrigin()).toEqual({ origin, error: null });
  });

  it("keeps a port, which a deployment behind one still needs", () => {
    vi.stubEnv("APP_ORIGIN", "https://tenders.example.com:8443");

    expect(appOrigin().origin).toBe("https://tenders.example.com:8443");
  });

  it("normalises a trailing slash rather than building `//tenders` out of it", () => {
    vi.stubEnv("APP_ORIGIN", `${origin}/`);

    expect(appOrigin()).toEqual({ origin, error: null });
    expect(linksFor(appOrigin().origin).tenders()).toBe(`${origin}/tenders?mine=0`);
  });

  /**
   * Named rather than reported as one "invalid" — each of these is a different paste and
   * a different fix, and the deployment gate prints this string as the whole of what a
   * reader sees.
   */
  it.each([
    ["unset", undefined, /not set/i],
    ["blank", "", /not set/i],
    ["only whitespace", "   ", /not set/i],
    ["not a URL at all", "tenders.example.com", /absolute/i],
    ["http rather than https", "http://tenders.example.com", /https/i],
    ["carrying a path", "https://tenders.example.com/app", /origin/i],
    ["carrying a query", "https://tenders.example.com?from=wecom", /origin/i],
    ["carrying a fragment", "https://tenders.example.com#top", /origin/i],
  ])("refuses one that is %s, and says which", (_name, value, expected) => {
    if (value === undefined) {
      vi.stubEnv("APP_ORIGIN", undefined);
    } else {
      vi.stubEnv("APP_ORIGIN", value);
    }

    const read = appOrigin();

    expect(read.origin).toBeNull();
    expect(read.error).toMatch(expected);
    // The fix is "set this variable", so the variable has to be in the sentence.
    expect(read.error).toContain("APP_ORIGIN");
  });

  it("names the value it refused, because the fix is usually visible in it", () => {
    vi.stubEnv("APP_ORIGIN", "http://tenders.example.com");

    expect(appOrigin().error).toContain("http://tenders.example.com");
  });
});

describe("the links themselves", () => {
  const links = linksFor(origin);

  it("points at the Tenders list, one Tender, and one Tender Item", () => {
    // `?mine=0` and not a bare `/tenders`, which means Mine. The Digest is one message
    // to a whole group and every reader taps the same link — see `linksFor`.
    expect(links.tenders()).toBe(`${origin}/tenders?mine=0`);
    expect(links.tender("t-1")).toBe(`${origin}/tenders/t-1`);
    expect(links.tenderItem("t-1", "i-9")).toBe(`${origin}/tenders/t-1/items/i-9/quote`);
  });

  it("carries no locale segment (ADR-0011)", () => {
    // Locale is not in the URL by decision — the reader gets their stored locale on
    // arrival. A link that pinned one would hand every reader whoever's the run had.
    const every = [links.tenders(), links.tender("t-1"), links.tenderItem("t-1", "i-9")];

    for (const link of every) {
      expect(link).not.toMatch(/\/(en|zh-Hans|zh)(\/|$)/);
    }
  });

  it("gives nothing at all when there is no origin, rather than a relative URL", () => {
    // A relative path in a WeCom message is a line of text that looks like a link and
    // is not one. Nothing is the honest answer, and every builder renders it as silence.
    const none = linksFor(null);

    expect(none.tenders()).toBeNull();
    expect(none.tender("t-1")).toBeNull();
    expect(none.tenderItem("t-1", "i-9")).toBeNull();
  });

  it("escapes an id rather than trusting it into a URL", () => {
    expect(links.tender("a b")).toBe(`${origin}/tenders/a%20b`);
  });

  /**
   * The one thing a unit test of a string builder cannot otherwise catch: a route that
   * moved. These links are posted into a group chat and cannot be unposted, so a 404 is
   * expensive in a way a broken in-app `<Link>` is not — nothing in the app imports
   * these paths, so nothing else would notice.
   */
  it.each([
    ["/tenders", "src/app/(app)/tenders/page.tsx"],
    ["/tenders/[id]", "src/app/(app)/tenders/[id]/page.tsx"],
    [
      "/tenders/[id]/items/[itemId]/quote",
      "src/app/(app)/tenders/[id]/items/[itemId]/quote/page.tsx",
    ],
  ])("resolves %s to a route that exists on disk", (path, file) => {
    // Paths only: a query string is the screen's business and not a route on disk.
    const root = fileURLToPath(new URL("../../", import.meta.url));

    expect(existsSync(`${root}${file}`)).toBe(true);
    // The pairing, not two independent facts: the file above is the one this path names.
    expect(`src/app/(app)${path}/page.tsx`).toBe(file);
  });

  it("builds each of those three paths and no others", () => {
    const built = [links.tenders(), links.tender("id"), links.tenderItem("id", "itemId")];

    expect(built.map((link) => link!.slice(origin.length))).toEqual([
      "/tenders?mine=0",
      "/tenders/id",
      "/tenders/id/items/itemId/quote",
    ]);
  });
});

describe("appLinks, which is the two halves joined", () => {
  it("links when the environment holds a usable origin", () => {
    vi.stubEnv("APP_ORIGIN", origin);

    expect(appLinks().tender("t-1")).toBe(`${origin}/tenders/t-1`);
  });

  it("falls silent on a refused origin rather than posting a broken URL", () => {
    vi.stubEnv("APP_ORIGIN", "http://tenders.example.com");

    expect(appLinks().tender("t-1")).toBeNull();
  });
});
