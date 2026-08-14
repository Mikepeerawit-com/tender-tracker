import { describe, expect, it } from "vitest";

import { ownerOptions, type Member } from "./members";

/**
 * The Owner picker is a `<select>` over the org's active members, and a `<select>` whose
 * value matches none of its options does not stay empty — the browser shows the first
 * option instead. So a Tender owned by a since-disabled colleague renders as owned by
 * whoever sorts first by name, and saving the form makes that true.
 *
 * `listMembers` is right to leave disabled people out; the fix is that the Owner this
 * Tender already has is not a pick, it is a fact the form has to be able to show.
 */

const members: Member[] = [
  { id: "anong", name: "Anong" },
  { id: "malee", name: "Malee" },
];

describe("ownerOptions", () => {
  it("offers the active members when the Owner is one of them", () => {
    expect(ownerOptions(members, { id: "malee", name: "Malee" })).toEqual([
      { id: "anong", name: "Anong", former: false },
      { id: "malee", name: "Malee", former: false },
    ]);
  });

  it("keeps an Owner who is no longer an active member", () => {
    const options = ownerOptions(members, { id: "somchai", name: "Somchai" });

    expect(options).toContainEqual({ id: "somchai", name: "Somchai", former: true });
  });

  it("marks that Owner as former, so the form can say so", () => {
    // Indistinguishable from an active colleague is how a Tender quietly stays with
    // somebody who has left.
    const options = ownerOptions(members, { id: "somchai", name: "Somchai" });

    expect(options.filter((option) => option.former).map((option) => option.id)).toEqual([
      "somchai",
    ]);
  });

  it("offers only the active members when there is no Owner yet", () => {
    // The record screen: nothing is owned, so there is nothing to preserve.
    expect(ownerOptions(members, null)).toEqual([
      { id: "anong", name: "Anong", former: false },
      { id: "malee", name: "Malee", former: false },
    ]);
  });

  it("ignores an Owner with no id", () => {
    expect(ownerOptions(members, { id: "", name: "" })).toHaveLength(members.length);
  });
});
