import { describe, expect, it } from "vitest";

import { switchTheme } from "./theme";

describe("switchTheme", () => {
  it("refuses a theme the token file does not paint", async () => {
    // The value reaches `<html>` as a class name and `users.theme` as a column value.
    // The column has a check constraint and would refuse this one; the class would not,
    // and a document carrying `theme-sepia` is a screen painted in whatever the palette
    // fell back to. Refused at the action, before either.
    await expect(switchTheme("sepia")).rejects.toThrow("Unsupported theme: sepia");
  });
});
