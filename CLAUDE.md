# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out (a
linter, say), a fact about the stack that is easy to get wrong --- write it down
here and wire it into `check`. Growing this file is the work.

## What earlier weeks taught me

Carried forward by hand rather than wholesale: these are rules about how I
work, not about what I built. The assignment-1 rules that described a
difficulty game — normalised coordinates, three hearts, the ladder presets,
its state mirror — were deliberately left behind, because a rule kept past its
subject is just noise a later reader has to disprove.

### A rule in this file is not a rule until something fails when it is broken

Assignment 1's CLAUDE.md described touch input from before its first line of
code. It was never implemented. At 390×844 — a viewport the course weights in
full — the player could not move by any means, and nothing caught it: every
input test dispatched keyboard events, and every browser check measured
layout. Forty-seven passing tests and eleven browser assertions, none of which
had ever asked whether the thing could be played on half of its marking
environment.

So a rule here is a liability until a sensor stands behind it. When I write
one, the next question is what would fail if it were ignored.

### An assertion goes green most easily when its subject is absent

Seven times in one week. A `canvas.width > 0` passing on jsdom's stock
300×150. A viewport check green since the day it was written while loading an
empty page over `file://`. A `devicePixelRatio` term pinned at 1, hiding a
canvas that really did render blurry. A `FRAME_BUDGET_MS` gating nothing under
a comment claiming full frame rate. Two touch tests that passed before touch
existed, because a player who never moves satisfies "stops when the finger
lifts".

The habit that came out of it: **I don't trust a check I haven't watched
fail.** Break the thing on purpose, see the red, then fix it. Three of the
sensors in this repo found real defects that a full green suite was sitting
quietly beside.

### A key event has to be attributed to an owner before it is acted on

When focus is inside a form control, the key belongs to that control — the
page must not also consume it, and must not `preventDefault` it. When the page
does consume a key, it must `preventDefault`, or the browser scrolls out from
under whatever the visitor is using. Both halves are one rule; either alone is
a bug, and I have shipped both bugs.

### pnpm brings its own Node; `mise.toml` alone does not bind it

`mise` installs pnpm as a standalone binary with Node embedded, so `pnpm exec`
runs under that embedded Node whatever `mise.toml` says, and a Node older than
22 cannot load a `.ts` file at all. The failure looks like a broken test and
is really a broken toolchain. `.npmrc` (`use-node-version`) is the authority.
If a check dies with `ERR_UNKNOWN_FILE_EXTENSION`, compare `pnpm exec node -v`
against `mise current node` before touching any code.

### Measure the baseline before changing anything

Run the checks against the untouched starting state, and write down what was
already true. A check that is green from the start and a check that is green
because it measures nothing look identical unless you go and find out which
happened.

### PROCESS.md and reflections use my facts, not a plausible reconstruction

When I give you the facts of a moment you weren't present for — what I tried,
what I rejected, why — use them as given. If a beat is missing, ask me or
leave it out. Don't fill the gap with something plausible: I have to defend
every claim out loud at the crit, and I can only answer for alternatives I
actually weighed.

### My own sensors, carried forward

`scripts/check-a11y.ts` and `scripts/check-payload.ts` are mine, not the
template's: real-browser assertions for contrast, focus indicators, 44×44
touch targets, reduced motion, and a payload budget stated as three seconds of
a 400 kbit/s link. Wired in as `pnpm check:a11y` / `pnpm check:payload`,
outside the main `pnpm check` chain since a browser launch is slower than the
rest of the roster.

`scripts/check-viewports.ts` didn't survive the crossing — it asserted exactly
nine range inputs, a `game-state` dataset mirror, and a draggable "player" on
the canvas, all assignment-1's markup by name. That's last week's contract,
not a sensor, so it's deleted rather than carried. `check-a11y.ts`'s own mount
wait had the same nine-sliders check buried in it (line 56 of the old
version) — generalised to just the page load event for now. **It will start
passing vacuously the moment this week's instrument has any interactive
element to mount-check against, so replace the generic wait with a real one
(a `data-testid`, an `AudioContext` state) as soon as the page has something
to point it at** — that's the exact failure the rule above is about, and
leaving it generic past that point repeats it.

Baseline measured against the untouched starter (2026-08-21, before any
instrument code exists): contrast and focus indicators green at both
viewports; touch targets red at 390×844 — the starter's `Home` nav link
renders 43.1×18.0px, just under the 44px floor; no transitions defined yet, so
reduced-motion has nothing to check; payload 25.9 KB across 4 files, 0.5s over
a 400 kbit/s link, inside the 3s budget. Recorded so a green result later is
known to mean something changed, not that the check never ran.

### Harness changes get their own commit

A change to this file is not a side effect of a fix — it is the part of the
fix that outlives it. So it lands separately, immediately after the commit
that taught the lesson, with a message that names the lesson rather than the
file:

    main: make the strike position actually change the timbre
    CLAUDE.md: record the mode-weights-must-come-from-Bessel lesson

Read back, the history then shows where something was learned, not just where
something was edited. Bundling the rule into the fix hides that: a reviewer
sees one commit doing two jobs and cannot tell which part was the insight.

Prefix the subject with the area — `main:`, `styles.css:`, `spec:`,
`CLAUDE.md:`, `scripts:` — so a scan of the log reads as a sequence of moves.

### The thing only a person can judge has to be named, not tested

Last week's brief said it outright: an agent can build a synth and cannot hear
the result. Latency, whether a strike feels solid or thin, whether a timbre
change is audible or merely present in the maths — none of it appears in a
test suite, and four instruments passed every check I had while sounding like
one note. The fix was not a better check. It was to say out loud which claims
the checks could not hold, and to go and play the thing.

This week the same rule has a new subject. The brief says the no-tutorial rule
is the one thing here that cannot be put under test: whether a stranger works
the game out in ten seconds is settled by watching four people try it, not by
an assertion. So the standing order is the same one, generalised:

**Name the claims no check can hold, then go and check them the only way they
can be checked — by using the thing, or by watching somebody else use it.**

A green check protects the page from being broken. It has never once told me
the thing was any good.

## This week: a game, and it has to be able to end

The brief inverts last week's. The harp was built so there was no way to play
it wrong — pentatonic strings, no fail state, no score. This week failure must
be possible and play must reach an ending. A rule carried over from the harp
that forbids losing is a rule kept past its subject, and this file has already
been burned by one of those.

Two constraints are worth writing down before any code exists, because both
are easy to violate by accident:

- **No instructions anywhere.** Not a modal, not a help page, not a line of
  text under the canvas. The opening screen has to make the first move
  obvious, and every mechanic after that is taught by playing. Last week's
  page opened with a paragraph explaining the instrument and had to be pulled
  apart when I read the brief properly; here there is no paragraph to write in
  the first place.
- **One rule under test.** The spec asks for a focused automated test on a
  single game rule. Pick the rule that decides whether play can end, and write
  the test before the rule works.
