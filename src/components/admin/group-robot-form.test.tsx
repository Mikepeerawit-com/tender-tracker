import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { GroupRobotForm } from "./group-robot-form";

/**
 * **One form, two submits, and only one of them working at a time** (#144).
 *
 * Every other control in this ticket is one button in a form of its own, so `isPending`
 * and *the button that was pressed* are the same fact. This form is the exception: Save
 * and Remove post to the same action, and a word taken from `isPending` alone would put
 * *Saving…* and *Removing…* on screen together — which is worse than the fade it replaced,
 * because it is a screen making a claim rather than a screen saying nothing.
 *
 * `pending.layout.test.tsx` presses each of these buttons and asks what *it* now says. It
 * cannot ask what the other one says, by design: what it walks is the control a thumb
 * landed on. That second half is this file.
 */

vi.mock("@/app/actions/admin", () => ({
  // Never settles, so the beat lasts as long as the assertions need it to.
  setGroupRobotAction: () => new Promise(() => {}),
}));

function draw() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GroupRobotForm configured updatedAt="2026-08-14T04:00:00Z" />
    </NextIntlClientProvider>,
  );
}

const said = (name: string) => screen.queryByRole("button", { name });

describe("the WeCom group's two buttons", () => {
  it("says which one is saving, and leaves the other alone", async () => {
    const user = userEvent.setup();

    draw();
    await user.click(screen.getByRole("button", { name: messages.groupRobot.save }));

    expect(said(messages.groupRobot.saving)).not.toBeNull();
    expect(said(messages.groupRobot.removing)).toBeNull();
  });

  it("says which one is removing, and leaves the other alone", async () => {
    const user = userEvent.setup();

    draw();
    await user.click(screen.getByRole("button", { name: messages.groupRobot.remove }));

    expect(said(messages.groupRobot.removing)).not.toBeNull();
    expect(said(messages.groupRobot.saving)).toBeNull();
  });

  it("reads a keyboard submit from the box as the Save it is", async () => {
    // The case no `onClick` would ever have seen, and the reason the answer is taken from
    // what was posted rather than from what was clicked: Enter in a single-line field
    // submits the form through its first button, which is Save, and the FormData that
    // arrives carries no `intent` at all.
    const user = userEvent.setup();

    draw();
    await user.click(screen.getByLabelText(messages.groupRobot.label));
    await user.keyboard("{Enter}");

    expect(said(messages.groupRobot.saving)).not.toBeNull();
    expect(said(messages.groupRobot.removing)).toBeNull();
  });
});
