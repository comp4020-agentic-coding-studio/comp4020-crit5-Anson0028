// The whole game, with no browser in it. No canvas, no requestAnimationFrame,
// no wall-clock reads: step() only ever advances by the dt it is handed. That
// is what lets the same function drive the rendered game and a headless run
// that finishes in milliseconds, which is how the upgrade pool gets checked
// for trap options rather than argued about.
//
// Everything is in normalised arena coordinates, 0 to 1 on both axes.

export type Vec2 = { x: number; y: number };
export type Enemy = Vec2 & { health: number; speed: number; hitCd: number; counted?: boolean };
export type Orb = Vec2 & { life: number };
export type Shot = Vec2 & { dx: number; dy: number; life: number };
export type Input = { x: number; y: number };

export type UpgradeId =
  | "speed"
  | "damage"
  | "rate"
  | "magnet"
  | "orbit"
  | "bolt"
  | "nova";

export type Upgrade = { id: UpgradeId; kind: "stat" | "weapon" };

// Seven, each five deep. Small enough to finish and to balance; wide enough
// that two runs are not the same run.
export const UPGRADES: readonly Upgrade[] = [
  { id: "speed", kind: "stat" },
  { id: "damage", kind: "stat" },
  { id: "rate", kind: "stat" },
  { id: "magnet", kind: "stat" },
  { id: "orbit", kind: "weapon" },
  { id: "bolt", kind: "weapon" },
  { id: "nova", kind: "weapon" },
];

export const MAX_LEVEL = 5;
export const RUN_MS = 120_000; // two minutes: an ending a stranger reaches
export const START_HEARTS = 3;

export type Build = Record<UpgradeId, number>;

export type Run = {
  player: Vec2;
  hearts: number;
  invulnerableFor: number;
  enemies: Enemy[];
  orbs: Orb[];
  shots: Shot[];
  build: Build;
  xp: number;
  level: number;
  pending: UpgradeId[] | null;
  kills: number;
  elapsedMs: number;
  outcome: "playing" | "won" | "lost";
  orbitPhase: number;
  cooldowns: { bolt: number; nova: number; spawn: number; field: number };
};

const PLAYER_SPEED = 0.26; // arena-fractions per second, before upgrades
const CONTACT_RADIUS = 0.030;
const INVULNERABLE_S = 1.2;
// Orbs do not rot. The field is meant to fill up: some are lying there before
// the first enemy arrives, and more keep arriving, so there is always
// something worth walking to. Capped only so the arena does not turn to
// confetti.
const ORB_LIFE_S = 1e9;
const FIELD_ORBS_AT_START = 14;
const FIELD_ORB_INTERVAL = 1.4;
const MAX_ORBS = 46;
const ORBIT_RADIUS = 0.10;
const ORBIT_RATE = 2.0; // turns per second
// A wide shard, not a point. At 0.045 and 2.6 turns a second the swept
// window was about a fifth of a turn, so an enemy walking through the ring
// was hit about one time in five — and a standing player killed nothing at
// all. In the headless runs the player is always moving, which sweeps the
// shard across enemies and hid it completely; it took standing still in the
// live game for six seconds with nothing dying to see it. A stranger's first
// key press has to make something happen.
const ORBIT_HIT = 0.062;
// Damage per hit, with a cooldown per enemy rather than damage per second of
// contact. Contact-time damage measured out as three dead upgrades: spinning
// faster swept each enemy more often but for proportionally less time, so the
// attack-rate upgrade was worth exactly nothing, and raw damage was pure
// overkill against three-health trash. Per-hit damage on a cooldown that
// shortens with attack rate makes all three of damage, rate and extra shards
// mean something — which is what the pool measurement is for.
const ORBIT_DAMAGE = 12;
const ORBIT_HIT_CD = 0.40; // seconds an enemy is immune to the shards for
const SHOT_SPEED = 0.75;

function emptyBuild(): Build {
  return { speed: 0, damage: 0, rate: 0, magnet: 0, orbit: 0, bolt: 0, nova: 0 };
}

export function createRun(rng: () => number = Math.random): Run {
  const scattered: Orb[] = [];
  for (let i = 0; i < FIELD_ORBS_AT_START; i++) {
    // Never right on top of the player: the first one has to be walked to.
    const a = rng() * Math.PI * 2;
    const r = 0.12 + rng() * 0.36;
    scattered.push({ x: clamp01(0.5 + Math.cos(a) * r), y: clamp01(0.5 + Math.sin(a) * r), life: ORB_LIFE_S });
  }
  return {
    player: { x: 0.5, y: 0.5 },
    hearts: START_HEARTS,
    invulnerableFor: 0,
    enemies: [],
    orbs: scattered,
    shots: [],
    // One weapon from the start, and it is the one that shoots. The orbiting
    // shard opened the game for a while and it asked too much: it only kills
    // what you walk into, so a player who has not worked that out yet stands
    // still and watches nothing die. A bolt that flies at the nearest thing
    // answers the first key press with a kill, and the shard is still in the
    // pool for anyone who wants it.
    build: { ...emptyBuild(), bolt: 1 },
    xp: 0,
    level: 1,
    pending: null,
    kills: 0,
    elapsedMs: 0,
    outcome: "playing",
    orbitPhase: 0,
    // The first weapon arrives almost immediately, because a player who has
    // pressed a key and seen nothing happen has already learned the wrong
    // thing about this game.
    cooldowns: { bolt: 0, nova: 0, spawn: 1.2, field: FIELD_ORB_INTERVAL },
  };
}

// --- derived stats ---------------------------------------------------------
// Every upgrade is a multiplier on one number. Flat bonuses stop mattering as
// a run goes on; multipliers keep the fifth level of a thing worth as much as
// the first, which is what makes a five-deep pool worth having.

export const moveSpeed = (b: Build) => PLAYER_SPEED * (1 + 0.30 * b.speed);
export const damageMul = (b: Build) => 1 + 0.30 * b.damage;
export const rateMul = (b: Build) => 1 + 0.32 * b.rate;
export const magnetRadius = (b: Build) => 0.055 * (1 + 1.0 * b.magnet);

/**
 * What one orb is worth. Radius alone made this upgrade a trap: measured at
 * -1.4 seconds against taking nothing, because a pickup reach generous enough
 * for a human to enjoy is already generous enough that more of it buys
 * nothing. Reach and value together is what "faster experience" has to mean
 * here, and it is the difference between a card that reads as a choice and a
 * card that punishes whoever picks it.
 */
export const xpPerOrb = (b: Build) => 1 + 0.4 * b.magnet;

/** How much XP a level costs. Rises, so the last upgrade is earned — and
 *  steeply enough that a run is not one long card screen. At 3 + 2L a
 *  two-minute run reached level 24 — a level-up every five seconds, a game
 *  about choosing rather than about moving. At 5 + 4L it reached nine and
 *  most of the pool never came out. This is fourteen, about one every eight
 *  seconds, and an ordinary player wins about two runs in five. */
export const xpForLevel = (level: number) => 3 + level * 3;

// --- levelling -------------------------------------------------------------

/** Three distinct upgrades, none of them already maxed. */
export function offerChoices(build: Build, rng: () => number): UpgradeId[] {
  const pool = UPGRADES.filter((u) => build[u.id] < MAX_LEVEL).map((u) => u.id);
  const picked: UpgradeId[] = [];
  const bag = [...pool];
  while (picked.length < 3 && bag.length > 0) {
    picked.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  }
  // Only reachable if fewer than three things are left unmaxed, which the
  // run length makes impossible — but a card face with a hole in it is worse
  // than a repeat, so it repeats rather than showing two.
  while (picked.length < 3 && pool.length > 0) picked.push(pool[picked.length % pool.length]);
  return picked;
}

export function applyUpgrade(run: Run, id: UpgradeId): void {
  if (run.build[id] >= MAX_LEVEL) return;
  run.build[id]++;
  run.pending = null;
}

// --- the loop --------------------------------------------------------------

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Enemies arrive faster and tougher as the run goes on. The player never
 *  chooses this; they only feel it. */
function spawnPressure(elapsedMs: number): { interval: number; health: number; speed: number; count: number } {
  const t = elapsedMs / RUN_MS;
  return {
    interval: 1.7 - 1.35 * t,
    health: 3 + 34 * t,
    // Fast enough by the end to catch a player who has not levelled their
    // legs: 0.29 against a base 0.26. When they topped out under the player's
    // own speed, the movement card measured at nothing, because there was
    // never anything to outrun.
    speed: 0.12 + 0.17 * t,
    count: 1 + Math.floor(t * 4),
  };
}

function spawnEnemy(run: Run, rng: () => number, p: ReturnType<typeof spawnPressure>): void {
  // Around the edge, so nothing ever appears on top of the player.
  const edge = Math.floor(rng() * 4);
  const along = rng();
  const at =
    edge === 0 ? { x: along, y: -0.03 }
    : edge === 1 ? { x: along, y: 1.03 }
    : edge === 2 ? { x: -0.03, y: along }
    : { x: 1.03, y: along };
  run.enemies.push({ ...at, health: p.health, speed: p.speed, hitCd: 0 });
}

function hurt(run: Run, enemy: Enemy, amount: number): void {
  enemy.health -= amount;
  if (enemy.health <= 0 && !enemy.counted) {
    enemy.counted = true;
    run.kills++;
    run.orbs.push({ x: enemy.x, y: enemy.y, life: ORB_LIFE_S });
  }
}

export function step(run: Run, dt: number, input: Input, rng: () => number): void {
  if (run.outcome !== "playing" || run.pending) return;
  const b = run.build;
  run.elapsedMs += dt * 1000;
  run.invulnerableFor = Math.max(0, run.invulnerableFor - dt);

  // Move. This is the only thing the player ever does.
  const mag = Math.hypot(input.x, input.y);
  if (mag > 0) {
    const s = moveSpeed(b) * dt;
    run.player.x = clamp01(run.player.x + (input.x / mag) * s);
    run.player.y = clamp01(run.player.y + (input.y / mag) * s);
  }

  // More experience keeps arriving, wherever it likes. The field is the
  // reason to keep moving once the thing chasing you is dead.
  run.cooldowns.field -= dt;
  if (run.cooldowns.field <= 0) {
    run.cooldowns.field += FIELD_ORB_INTERVAL;
    if (run.orbs.length < MAX_ORBS) {
      run.orbs.push({ x: clamp01(rng()), y: clamp01(rng()), life: ORB_LIFE_S });
    }
  }

  const p = spawnPressure(run.elapsedMs);
  run.cooldowns.spawn -= dt;
  if (run.cooldowns.spawn <= 0) {
    for (let i = 0; i < p.count; i++) spawnEnemy(run, rng, p);
    run.cooldowns.spawn += p.interval;
  }

  for (const e of run.enemies) {
    e.hitCd -= dt;
    const d = dist(e, run.player) || 1;
    e.x += ((run.player.x - e.x) / d) * e.speed * dt;
    e.y += ((run.player.y - e.y) / d) * e.speed * dt;
  }

  // Weapons. None of them is aimed: the player's only control is standing
  // somewhere, so every weapon fires off its own clock and hits whatever the
  // player has walked into range of.
  if (b.orbit > 0) {
    run.orbitPhase += ORBIT_RATE * rateMul(b) * dt;
    for (let i = 0; i < b.orbit; i++) {
      const a = run.orbitPhase + (i * Math.PI * 2) / b.orbit;
      const at = { x: run.player.x + Math.cos(a) * ORBIT_RADIUS, y: run.player.y + Math.sin(a) * ORBIT_RADIUS };
      for (const e of run.enemies) {
        if (e.hitCd <= 0 && dist(e, at) < ORBIT_HIT) {
          hurt(run, e, ORBIT_DAMAGE * damageMul(b));
          e.hitCd = ORBIT_HIT_CD / rateMul(b);
        }
      }
    }
  }

  if (b.bolt > 0) {
    run.cooldowns.bolt -= dt * rateMul(b);
    if (run.cooldowns.bolt <= 0) {
      run.cooldowns.bolt += 0.75;
      const alive = run.enemies.filter((e) => e.health > 0);
      for (let i = 0; i < b.bolt && alive.length > 0; i++) {
        const target = alive.reduce((best, e) => (dist(e, run.player) < dist(best, run.player) ? e : best), alive[0]);
        const d = dist(target, run.player) || 1;
        run.shots.push({
          x: run.player.x,
          y: run.player.y,
          dx: (target.x - run.player.x) / d,
          dy: (target.y - run.player.y) / d,
          life: 1.4,
        });
        alive.splice(alive.indexOf(target), 1);
      }
    }
  }

  if (b.nova > 0) {
    run.cooldowns.nova -= dt * rateMul(b);
    if (run.cooldowns.nova <= 0) {
      run.cooldowns.nova += 2.6;
      const radius = 0.10 + 0.035 * b.nova;
      for (const e of run.enemies) {
        if (dist(e, run.player) < radius) hurt(run, e, 16 * b.nova * damageMul(b));
      }
    }
  }

  for (const s of run.shots) {
    s.x += s.dx * SHOT_SPEED * dt;
    s.y += s.dy * SHOT_SPEED * dt;
    s.life -= dt;
    for (const e of run.enemies) {
      if (e.health > 0 && dist(e, s) < 0.026) {
        hurt(run, e, 22 * damageMul(b));
        s.life = 0;
        break;
      }
    }
  }
  run.shots = run.shots.filter((s) => s.life > 0 && s.x > -0.1 && s.x < 1.1 && s.y > -0.1 && s.y < 1.1);
  run.enemies = run.enemies.filter((e) => e.health > 0);

  // Contact. One heart per immunity window however many are touching:
  // otherwise three frames of overlap take three hearts in fifty milliseconds.
  if (run.invulnerableFor <= 0) {
    for (const e of run.enemies) {
      if (dist(e, run.player) < CONTACT_RADIUS) {
        run.hearts--;
        run.invulnerableFor = INVULNERABLE_S;
        break;
      }
    }
  }

  // XP has to be walked into. That is what keeps the only verb honest: the
  // orbs land where the fighting was, so getting stronger means going back
  // into it.
  const pull = magnetRadius(b);
  run.orbs = run.orbs.filter((o) => {
    o.life -= dt;
    const d = dist(o, run.player);
    if (d < pull) {
      const k = Math.min(1, (dt * 2.2) / Math.max(d, 0.001));
      o.x += (run.player.x - o.x) * k;
      o.y += (run.player.y - o.y) * k;
    }
    if (dist(o, run.player) < 0.022) {
      run.xp += xpPerOrb(b);
      return false;
    }
    return o.life > 0;
  });

  while (run.xp >= xpForLevel(run.level)) {
    run.xp -= xpForLevel(run.level);
    run.level++;
    run.pending = offerChoices(run.build, rng);
    break;
  }

  if (run.hearts <= 0) run.outcome = "lost";
  else if (run.elapsedMs >= RUN_MS) run.outcome = "won";
}

// --- headless ---------------------------------------------------------------

export type Policy = (run: Run) => Input;

/** Walk away from the nearest thing that can hurt you. */
export const fleePolicy: Policy = (run) => {
  if (run.enemies.length === 0) return { x: 0, y: 0 };
  const near = run.enemies.reduce((a, e) => (dist(e, run.player) < dist(a, run.player) ? e : a), run.enemies[0]);
  const away = { x: run.player.x - near.x, y: run.player.y - near.y };
  // Bounce off the walls rather than reversing into a corner, which is how a
  // fleeing policy dies and would have made "this run is winnable" false for
  // reasons that have nothing to do with the game.
  const toCentre = { x: 0.5 - run.player.x, y: 0.5 - run.player.y };
  const edge = Math.max(Math.abs(run.player.x - 0.5), Math.abs(run.player.y - 0.5));
  const w = edge > 0.36 ? 2.2 : 0;
  return { x: away.x + toCentre.x * w, y: away.y + toCentre.y * w };
};

/**
 * Go and get the experience while staying off the things that hurt — which is
 * what a person actually does, and therefore the only policy the game may be
 * balanced against. The first version of this walked straight at the nearest
 * orb and ignored everything else; it died at thirty seconds, and every
 * balance number measured against it was measured against a player nobody is.
 *
 * A sum of pulls and pushes: towards the nearest orb, away from anything close
 * enough to touch, and away from the walls, which are where you die when you
 * back into one.
 */
export const chaseXpPolicy: Policy = (run) => {
  let x = 0;
  let y = 0;
  if (run.orbs.length > 0) {
    const o = run.orbs.reduce((a, c) => (dist(c, run.player) < dist(a, run.player) ? c : a), run.orbs[0]);
    const d = dist(o, run.player) || 1;
    x += ((o.x - run.player.x) / d) * 1.0;
    y += ((o.y - run.player.y) / d) * 1.0;
  }
  for (const e of run.enemies) {
    const d = dist(e, run.player);
    if (d < 0.12) {
      const w = (0.12 - d) / 0.12;
      x -= ((e.x - run.player.x) / (d || 1)) * w * 4.0;
      y -= ((e.y - run.player.y) / (d || 1)) * w * 4.0;
    }
  }
  // Always a pull back towards the middle, not just near the wall: the first
  // version only pushed inside a 0.12 margin and the simulated player spent
  // whole runs pinned at (1.00, 1.00), where a corner does the enemies' work
  // for them. A policy that dies of the arena's shape is not measuring the
  // game.
  x += (0.5 - run.player.x) * 2.4;
  y += (0.5 - run.player.y) * 2.4;
  return { x, y };
};

/**
 * Wrap a policy in a person. It re-decides every reaction period rather than
 * every frame, holds the last direction in between, and aims a little wrong.
 *
 * Without this the simulated player has zero reaction time and perfect aim,
 * and the measurements said so: it won fifteen runs out of fifteen with every
 * build, including builds that were doing nothing, so the pool comparison
 * saturated at the ceiling and could not tell a good card from a dead one.
 * A test that cannot distinguish its subjects is not a test. It also made the
 * game look far easier than it is — playing it by hand, I was down to one
 * heart in twelve seconds while the bot was reaching level fourteen.
 */
export function withReaction(base: Policy, rng: () => number, reactionMs = 150): Policy {
  let held: Input = { x: 0, y: 0 };
  let nextAt = 0;
  return (run) => {
    if (run.elapsedMs >= nextAt) {
      nextAt = run.elapsedMs + reactionMs * (0.6 + rng() * 0.8);
      const d = base(run);
      const m = Math.hypot(d.x, d.y);
      const a = Math.atan2(d.y, d.x) + (rng() - 0.5) * 0.3;
      held = { x: Math.cos(a) * m, y: Math.sin(a) * m };
    }
    return held;
  };
}

/**
 * A whole run, as fast as the CPU can do it.
 *
 * `take` decides what the simulated player does with a level-up: "first" is an
 * ordinary player taking whatever is on the left, "none" declines every card,
 * and an id leans on that upgrade — takes it whenever it is offered, and takes
 * the leftmost otherwise.
 *
 * Two versions of this were wrong before it was right. The first had no way to
 * decline at all, so its "taking nothing" baseline was really "taking three
 * random cards" and it reported levelling speed as worse than not levelling.
 * The second made an id mean "take this and decline everything else", which is
 * a fair question for a weapon and a rigged one for an upgrade whose whole
 * value is getting you to the next upgrade sooner: it measured the experience
 * card at 1.5 seconds worse than never levelling, because it spent every level
 * of the run on getting to levels it then wasted.
 */
export function runHeadless(
  policy: Policy,
  rng: () => number,
  take: UpgradeId | "first" | "none" = "first",
): { outcome: Run["outcome"]; ms: number; run: Run } {
  const run = createRun(rng);
  const dt = 1 / 60;
  while (run.outcome === "playing" && run.elapsedMs < RUN_MS) {
    if (run.pending) {
      if (take === "none") run.pending = null;
      else if (take === "first") applyUpgrade(run, run.pending[0]);
      else applyUpgrade(run, run.pending.includes(take) ? take : run.pending[0]);
      continue;
    }
    step(run, dt, policy(run), rng);
  }
  return { outcome: run.outcome, ms: run.elapsedMs, run };
}
