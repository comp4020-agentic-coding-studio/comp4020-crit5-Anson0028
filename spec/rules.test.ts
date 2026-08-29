// The game's rules, tested without a browser. Red until rules.ts exists, and
// that is the point: red-to-green across the weekend is the work.
//
// The spec asks for "one rule of the game" to have a focused automated test,
// and the rule chosen is the one that decides whether play can end at all —
// levelling. A run that never levels never gets harder to survive and never
// finishes; a run that levels wrong offers the player a choice that isn't one.
import { describe, expect, it } from "vitest";
import {
  RUN_MS,
  UPGRADES,
  MAX_LEVEL,
  createRun,
  offerChoices,
  applyUpgrade,
  step,
  runHeadless,
  chaseXpPolicy,
  fleePolicy,
  withReaction,
  kindsAt,
  BOSS_TIMES_MS,
  BOSS_WINDOW_MS,
} from "../rules";

const seeded = (n: number) => {
  let s = n >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

describe("the rule that decides whether play can end: levelling", () => {
  it("offers exactly three distinct upgrades", () => {
    const rng = seeded(1);
    for (let i = 0; i < 200; i++) {
      const run = createRun();
      const choices = offerChoices(run.build, rng);
      expect(choices).toHaveLength(3);
      expect(new Set(choices).size).toBe(3);
    }
  });

  it("never offers an upgrade that is already at its maximum", () => {
    // A maxed option on the card is a choice that isn't a choice — the player
    // spends a level-up on nothing and cannot know that until afterwards.
    const rng = seeded(2);
    const run = createRun();
    for (const id of ["speed", "damage"] as const) {
      for (let i = 0; i < MAX_LEVEL; i++) applyUpgrade(run, id);
      expect(run.build[id]).toBe(MAX_LEVEL);
    }
    for (let i = 0; i < 200; i++) {
      expect(offerChoices(run.build, rng)).not.toContain("speed");
      expect(offerChoices(run.build, rng)).not.toContain("damage");
    }
  });

  it("still offers three when the pool is nearly exhausted", () => {
    // The pool shrinks as the run goes on, and the last few level-ups are
    // exactly when a silent failure here would bite.
    const rng = seeded(3);
    const run = createRun();
    const ids = UPGRADES.map((u) => u.id);
    for (const id of ids.slice(0, ids.length - 3)) {
      for (let i = 0; i < MAX_LEVEL; i++) applyUpgrade(run, id);
    }
    expect(offerChoices(run.build, rng)).toHaveLength(3);
  });
});

describe("spec: a wrong move is possible", () => {
  it("has a state where one input survives and another does not", () => {
    // The brief's words. This is the assertion that says the game can be
    // played badly — not that it is hard, but that where you stand decides
    // the outcome, which is the whole game.
    const run = createRun();
    // Tough enough to survive being shot at, because the claim under test is
    // about where you stand and not about how fast you kill. At ten health the
    // opening bolt destroyed it before it could touch anybody and the
    // assertion failed for the wrong reason.
    run.enemies = [{ x: 0.5, y: 0.42, health: 5000, maxHealth: 5000, speed: 0, hitCd: 99, kind: "walker" as const, cd: 999 }];
    run.player = { x: 0.5, y: 0.5 };
    const into = structuredClone(run);
    const away = structuredClone(run);
    const rng = seeded(4);
    for (let i = 0; i < 30; i++) {
      step(into, 1 / 60, { x: 0, y: -1 }, rng);
      step(away, 1 / 60, { x: 0, y: 1 }, rng);
    }
    expect(into.hearts).toBeLessThan(run.hearts);
    expect(away.hearts).toBe(run.hearts);
  });
});

describe("spec: play ends somewhere", () => {
  it("can be won", () => {
    // A win is rare enough now that it needs looking for across seeds rather
    // than being asserted on one. It has to exist — a game with no reachable
    // ending fails the brief outright — but a two-minute run with two bosses
    // in it is not something an average run reaches, and pretending otherwise
    // by picking a friendly seed would be dressing the number up.
    const wins = Array.from({ length: 15 }, (_, i) => {
      const rng = seeded((i + 1) * 97);
      return runHeadless(withReaction(chaseXpPolicy, rng), rng, "first");
    }).filter((r) => r.outcome === "won");
    expect(wins.length).toBeGreaterThan(0);
    expect(wins[0].ms).toBeGreaterThanOrEqual(RUN_MS);
  });

  it("cannot be won by declining every card, however well you dodge", () => {
    // This assertion has been rewritten twice by measurements, and both
    // rewrites were the game changing under it rather than the test being
    // wrong. It began as "cannot be won by running away", which held while
    // the only experience fell out of dead enemies. Experience on the field
    // killed that, so it became "going for it beats running from it" — and
    // then the boss killed *that*, because a boss window is a survival check
    // and dodging is how you survive: measured, fleeing now outlives chasing,
    // 120s against 56s.
    //
    // What is true of the game as it now stands is the thing worth asserting.
    // Whatever you do with your feet, the first boss has more health than the
    // opening weapon can remove inside its window, so a run that took no
    // upgrades ends there.
    const wall = BOSS_TIMES_MS[0] + BOSS_WINDOW_MS;
    for (const policy of [chaseXpPolicy, fleePolicy]) {
      for (let seed = 1; seed <= 6; seed++) {
        const rng = seeded(seed * 97);
        const { outcome, ms } = runHeadless(withReaction(policy, rng), rng, "none");
        expect(outcome).toBe("lost");
        expect(ms).toBeLessThanOrEqual(wall + 200);
      }
    }
  });

  it("can be lost", () => {
    const { outcome, ms } = runHeadless(() => ({ x: 0, y: 0 }), seeded(6));
    expect(outcome).toBe("lost");
    expect(ms).toBeLessThan(RUN_MS);
  });

  it("always terminates, whatever the player does", () => {
    // No policy, however bad or however lucky, may leave a run running past
    // its own length. An unbounded run is an unfinishable game.
    for (let seed = 1; seed <= 12; seed++) {
      const { ms } = runHeadless(chaseXpPolicy, seeded(seed));
      // Plus one frame: a win is declared on the step that crosses RUN_MS, so
      // the run can end a sixtieth of a second past its own length. The first
      // version of this asserted an exact ceiling and went red on wins.
      expect(ms).toBeLessThanOrEqual(RUN_MS + 1000 / 60);
    }
  });
});

describe("the boss is where not gathering gets asked about", () => {
  it("arrives on the clock, with a clock of its own", () => {
    const rng = seeded(11);
    const run = createRun(rng);
    while (run.elapsedMs < BOSS_TIMES_MS[0] - 100) {
      if (run.pending) run.pending = null;
      step(run, 1 / 60, { x: 0, y: 0 }, rng);
      if (run.outcome !== "playing") break;
    }
    expect(run.enemies.some((e) => e.boss)).toBe(false);
    for (let i = 0; i < 12; i++) step(run, 1 / 60, { x: 0, y: 0 }, rng);
    expect(run.enemies.some((e) => e.boss)).toBe(true);
    expect(run.bossDeadline).toBeCloseTo(BOSS_TIMES_MS[0] + BOSS_WINDOW_MS, -2);
  });

  it("ends a run that never picked anything up, and at the wall rather than slowly", () => {
    // The rule the whole design turns on. A player who has been gathering can
    // put the first boss down inside its window; one who declined every card
    // cannot, and the run stops there. Without this the punishment for not
    // levelling was only that you died a bit sooner, which is not something a
    // player can notice, let alone learn from.
    const wall = BOSS_TIMES_MS[0] + BOSS_WINDOW_MS;
    for (let seed = 1; seed <= 9; seed++) {
      const rng = seeded(seed * 97);
      const { outcome, ms } = runHeadless(withReaction(chaseXpPolicy, rng), rng, "none");
      expect(outcome).toBe("lost");
      expect(ms).toBeLessThanOrEqual(wall + 200);
    }
  });

  it("is passable by a player who did", () => {
    const wall = BOSS_TIMES_MS[0] + BOSS_WINDOW_MS;
    let past = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const rng = seeded(seed * 97);
      if (runHeadless(withReaction(chaseXpPolicy, rng), rng, "first").ms > wall) past++;
    }
    expect(past).toBeGreaterThan(7);
  });
});

describe("the three kinds, and when they turn up", () => {
  it("opens with only the kind that teaches the game", () => {
    // Nothing new is ever the first thing a player meets. Walkers say "this
    // comes at you"; a shooter or a charger on the opening screen would be
    // teaching two things at once with no words to do it in.
    expect(kindsAt(0)).toEqual(["walker"]);
    expect(kindsAt(30_000)).toContain("shooter");
    expect(kindsAt(30_000)).not.toContain("charger");
    expect(kindsAt(60_000)).toEqual(["walker", "shooter", "charger"]);
  });

  it("actually produces all three, and things they fire", () => {
    const rng = seeded(21);
    const run = createRun(rng);
    const seen = new Set<string>();
    let hazards = 0;
    while (run.elapsedMs < 70_000 && run.outcome === "playing") {
      if (run.pending) run.pending = null;
      // Kept alive on purpose. The question is what the game produces over
      // seventy seconds, and a run that dies at forty answers a different
      // one — the first version of this failed because the chargers arrive
      // after the player it was watching had already been killed.
      run.hearts = 9;
      run.bossDeadline = null;
      step(run, 1 / 60, { x: 0.2, y: 0.1 }, rng);
      for (const e of run.enemies) seen.add(e.kind);
      hazards = Math.max(hazards, run.hazards.length);
    }
    expect([...seen].sort()).toEqual(["charger", "shooter", "walker"]);
    expect(hazards).toBeGreaterThan(0);
  });

  it("charges where you were, not where you are", () => {
    // A charge that steers is a fast walker. This is the whole reason the
    // kind exists: it commits, and stepping aside works.
    const rng = seeded(22);
    const run = createRun(rng);
    run.enemies = [
      { x: 0.5, y: 0.2, health: 999, maxHealth: 999, speed: 0, hitCd: 99, kind: "charger" as const, cd: 0 },
    ];
    run.player = { x: 0.5, y: 0.5 };
    step(run, 1 / 60, { x: 0, y: 0 }, rng);
    const charger = run.enemies[0];
    expect(charger.dash).toBeTruthy();
    const aim = { ...charger.dash! };
    run.player = { x: 0.1, y: 0.5 };
    for (let i = 0; i < 10; i++) step(run, 1 / 60, { x: 0, y: 0 }, rng);
    expect(charger.dash!.x).toBeCloseTo(aim.x, 5);
    expect(charger.dash!.y).toBeCloseTo(aim.y, 5);
  });
});

describe("spec: no upgrade in the pool is a trap", () => {
  it("every upgrade survives longer than taking nothing", () => {
    // Measured, not asserted from the design. A pool where one option is a
    // punishment makes the three-card choice a trap for a player who cannot
    // read the numbers — and there are no numbers to read, by design.
    // Fifteen runs each. Nine was not enough to separate a dead upgrade from a
    // live one: at nine, damage measured half a second *worse* than taking
    // nothing, which was noise wearing a finding's clothes.
    const baseline = median(runsTaking("none", 15));
    for (const upgrade of UPGRADES) {
      const withIt = median(runsTaking(upgrade.id, 15));
      expect(withIt, `${upgrade.id} is not worth taking`).toBeGreaterThan(baseline);
    }
  });
});

function runsTaking(take: Parameters<typeof runHeadless>[2], trials: number): number[] {
  const out: number[] = [];
  for (let seed = 1; seed <= trials; seed++) {
    const rng = seeded(seed * 97);
    // Through a person, not a machine. With zero reaction time and perfect
    // aim every build won every run and this comparison saturated at the
    // ceiling — a test that cannot tell its subjects apart.
    out.push(runHeadless(withReaction(chaseXpPolicy, rng), rng, take).ms);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
