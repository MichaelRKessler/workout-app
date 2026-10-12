// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ConfirmSheet } from "@/components/workout/ConfirmSheet";
import { proposalToDraft, type DraftSet, type VoiceDraft } from "@/lib/voice/confirm";

vi.mock("@/components/workout/usePreviousExercise", () => ({
  usePreviousExercise: () => ({ loading: false, sets: null, label: null }),
}));

afterEach(() => {
  cleanup();
});

const set: DraftSet = {
  kind: "strength",
  reps: "10",
  weight: "30",
  duration: "",
  distance: "",
  calories: "",
  rpe: "",
  weightLb: 30,
  setType: "working",
};

function Harness({ onDiscard }: { onDiscard: () => void }) {
  const [draft, setDraft] = useState<VoiceDraft>({
    note: "",
    exercises: [{ draftId: "stable-curl", exerciseName: "Curl", sets: [set] }],
  });
  return (
    <ConfirmSheet
      open
      draft={draft}
      source="text"
      saving={false}
      notice={null}
      onChange={setDraft}
      onDiscard={onDiscard}
      onConfirm={() => undefined}
      onRecordAgain={() => undefined}
    />
  );
}

test("editing the exercise name keeps the field focused", async () => {
  const user = userEvent.setup();
  render(<Harness onDiscard={() => undefined} />);
  const input = screen.getByLabelText("Exercise 1");
  expect(input).toBeInstanceOf(HTMLInputElement);
  await user.click(input);
  expect(document.activeElement).toBe(input);
  await user.keyboard("s");
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe("Curls");
});

test("the dimmed area leaves the parse, and Discard and Escape do not", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  render(<Harness onDiscard={onDiscard} />);

  const scrim = document.querySelector(".bg-scrim");
  expect(scrim).toBeInstanceOf(HTMLElement);
  await user.click(scrim as HTMLElement);
  expect(onDiscard).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

test("Escape discards the parse", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  render(<Harness onDiscard={onDiscard} />);
  await user.keyboard("{Escape}");
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

test("each parsed exercise gets its own id", () => {
  const draft = proposalToDraft({
    note: null,
    exercises: [
      {
        exerciseName: "Curl",
        sets: [
          {
            reps: 10,
            weightLb: 30,
            durationSec: null,
            distanceM: null,
            calories: null,
            rpe: null,
            setType: "working",
          },
        ],
      },
      {
        exerciseName: "Curl",
        sets: [
          {
            reps: 8,
            weightLb: 30,
            durationSec: null,
            distanceM: null,
            calories: null,
            rpe: null,
            setType: "working",
          },
        ],
      },
    ],
  });
  expect(draft.exercises[0]?.draftId).toBeTruthy();
  expect(draft.exercises[0]?.draftId).not.toBe(draft.exercises[1]?.draftId);
});

test("identical sets collapse into one row until they are edited", async () => {
  const user = userEvent.setup();
  function Many() {
    const [draft, setDraft] = useState<VoiceDraft>({
      note: "",
      exercises: [
        {
          draftId: "bench",
          exerciseName: "Bench",
          sets: [set, set, set],
        },
      ],
    });
    return (
      <ConfirmSheet
        open
        draft={draft}
        source="text"
        saving={false}
        notice={null}
        onChange={setDraft}
        onDiscard={() => undefined}
        onConfirm={() => undefined}
        onRecordAgain={() => undefined}
      />
    );
  }
  render(<Many />);
  expect(screen.queryByLabelText("Reps")).toBeNull();
  await user.click(screen.getByRole("button", { name: "3 × 10 @ 30 lb" }));
  expect(screen.getByLabelText("Reps")).toBeInstanceOf(HTMLElement);
  await user.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByLabelText("RPE")).toBeInstanceOf(HTMLElement);
});
