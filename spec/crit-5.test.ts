// This week's published spec, turned into backpressure. Red on purpose: there
// is no game yet, and red-to-green across the days is the work.
//
// Two of the spec's seven lines are here. The rest are recorded at the bottom
// of this file as what they are — either shipped by another gate, or settled
// by a person watching somebody play, which is the thing this brief says
// outright cannot be put under test.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const pages = readdirSync(DIST, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".html"))
  .map((e) => join(e.parentPath ?? DIST, e.name));

const html = pages.map((p) => readFileSync(p, "utf8")).join("\n");

describe("spec: it teaches itself — no instructions anywhere", () => {
  it("has something to play, so the check below can't pass on an empty page", () => {
    // Paired deliberately. "No instructions" is trivially true of a blank
    // page, and an assertion goes green most easily when its subject is
    // absent — this repo has been caught by that four times. So the
    // no-instructions rule only counts while there is a game to not explain.
    expect(html).toMatch(/data-testid="play"/);
  });

  it("explains nothing in words", () => {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, " ")
      .toLowerCase();
    // Not a list of banned words for their own sake: each of these is a way a
    // page starts doing the teaching that the opening screen is supposed to
    // do. The brief bans the modal, the help page and the line of text under
    // the canvas alike.
    for (const phrase of [
      "how to play",
      "instructions",
      "tutorial",
      "controls:",
      "use the arrow",
      "click to",
      "press space",
      "your goal",
      "objective",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });
});

// Still to write, once the mechanic is chosen — these are the spec lines that
// need a game before they can need a test:
//
//   "it can be lost: a wrong move is possible, and play ends somewhere — a
//   win, a loss or a finish"
//
// This is the line the spec's "one rule of the game has a focused automated
// test" should land on, because it is the rule that decides whether play can
// end at all. It needs the rules to exist as something callable without a
// browser — a pure module the test can drive to a loss and to a finish — so
// the shape of that module is a design decision, not a test decision, and
// guessing it here would be designing the game by accident.
//
// Settled by a person, not by this file:
//
//   "a stranger can pick it up and reach an ending inside five minutes" — the
//   pod plays cold until somebody finishes or gives up. Four people trying it
//   is the measurement; there isn't another one.
//
//   "the opening screen invites the first move" — a page can be checked for
//   the absence of words. Whether what is left invites anything cannot be.
//
//   "one change you made came from playing the finished game rather than
//   reading its code" — a commit, cited in PROCESS.md.
//
//   "you can account for how you directed, grounded and corrected the work" —
//   the crit conversation.
//
// Shipped by another gate: "deployed and live at its public Pages URL"
// (CI + ship), and "the repo shows the process" (pnpm check:evidence).
