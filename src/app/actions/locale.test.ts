import { describe, expect, it } from "vitest";

import { switchLocale } from "./locale";

describe("switchLocale", () => {
  it("refuses a locale the app does not ship", async () => {
    // The action writes a cookie that every later request reads. A locale that is
    // not one of the two must be rejected at the action, not discovered when a
    // page renders raw message keys at somebody.
    await expect(switchLocale("de")).rejects.toThrow("Unsupported locale: de");
  });
});
