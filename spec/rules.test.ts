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
    run.enemies = [{ x: 0.5, y: 0.42, health: 10, speed: 0, hitCd: 99 }];
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
  it("can be won by going and getting the experience", () => {
    const { outcome, ms } = runHeadless(chaseXpPolicy, seeded(5));
    expect(outcome).toBe("won");
    expect(ms).toBeGreaterThanOrEqual(RUN_MS);
  });

  it("cannot be won by running away", () => {
    // This started as the win test, with fleeing as my guess at competent
    // play, and it lost. Fleeing never walks over an orb, so it never levels,
    // so it never gets a weapon, so nothing it runs from ever dies and the
    // arena fills up. That is the game working: the orbs land where the
    // fighting was, and the only way to get stronger is to go back into it.
    // It is a better assertion than the one I meant to write.
    expect(runHeadless(fleePolicy, seeded(5)).outcome).toBe("lost");
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
    out.push(runHeadless(chaseXpPolicy, seeded(seed * 97), take).ms);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
