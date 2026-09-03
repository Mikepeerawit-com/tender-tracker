import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { MembershipControls } from "./membership-controls";

/**
 * The half of Disabling that only exists once the row is on screen: **which way the
 * control is pointing**.
 *
 * The write itself is proved against the real database in `@/lib/org/members`, and it
 * takes the direction as an argument — so nothing there can tell whether the button a
 * person presses asks for the direction they read on it. One control serves both, and its
 * intent is derived from the row rather than chosen by the caller, which is precisely the
 * kind of flip that would leave Restore quietly Disabling somebody a second time.
 *
 * The refusal is here for the same reason: `messages.test.ts` proves every status *has* a
 * sentence, and this proves the screen puts the one that came back in front of the admin
 * instead of swallowing it. The last-Org-Admin rule reaches a person only through this
 * span.
 */

const submitted: FormData[] = [];
let answer: { status?: string } = {};

vi.mock("@/app/actions/admin", () => ({
  setMembershipDisabledAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);

    return answer;
  },
}));

function draw(disabledAt: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MembershipControls userId="wirat" disabledAt={disabledAt} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  submitted.length = 0;
  answer = {};
});

describe("the control on a member's row", () => {
  it("offers to Disable a colleague who is still here", async () => {
    draw(null);

    await userEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].get("intent")).toBe("disable");
    expect(submitted[0].get("userId")).toBe("wirat");
  });

  it("offers to Restore one who has been Disabled", async () => {
    draw("2026-09-01T00:00:00Z");

    await userEvent.click(screen.getByRole("button", { name: /restore/i }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].get("intent")).toBe("readmit");
  });

  it("draws one direction at a time, so neither can be pressed by mistake", () => {
    draw(null);

    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
  });

  it("shows why the last Administrator was not Disabled", async () => {
    answer = { status: "last_admin" };

    draw(null);

    await userEvent.click(screen.getByRole("button", { name: /disable/i }));

    expect((await screen.findByRole("status")).textContent).toBe(
      messages.people.membership.status.last_admin,
    );
  });

  it("says so when the Membership really ended", async () => {
    answer = { status: "disabled" };

    draw(null);

    await userEvent.click(screen.getByRole("button", { name: /disable/i }));

    expect((await screen.findByRole("status")).textContent).toBe(
      messages.people.membership.status.disabled,
    );
  });
});
