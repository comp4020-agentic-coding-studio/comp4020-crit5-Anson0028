// The arena, the hand, and nothing else. Every rule lives in ./rules, which
// has no browser in it; this file draws that state and turns a keyboard, a
// mouse and a finger into the one input the game takes — a direction.
import {
  MAX_LEVEL,
  BOSS_RADIUS,
  BOSS_WINDOW_MS,
  RUN_MS,
  UPGRADES,
  applyUpgrade,
  createRun,
  TOUCH_RADIUS,
  drawRadius,
  step,
  xpForLevel,
  type Run,
  type UpgradeId,
} from "./rules";

const mount = document.querySelector<HTMLElement>("#arena");

if (mount) {
  // All three live in index.html, not here — see the comment there.
  const canvas = mount.querySelector<HTMLCanvasElement>('[data-testid="play"]')!;
  const cards = mount.querySelector<HTMLElement>('[data-testid="cards"]')!;
  const mirror = mount.querySelector<HTMLElement>('[data-testid="game-state"]')!;
  const verdict = mount.querySelector<HTMLElement>('[data-testid="verdict"]')!;
  const hudHearts = mount.querySelector<HTMLElement>('[data-testid="hearts"]')!;
  const hudLevel = mount.querySelector<HTMLElement>('[data-testid="level"]')!;
  const hudClock = mount.querySelector<HTMLElement>('[data-testid="clock"]')!;
  const hudTally = mount.querySelector<HTMLElement>('[data-testid="tally"]')!;

  const ctx = canvas.getContext("2d")!;
  let w = 0;
  let h = 0;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // A ResizeObserver on the canvas, not a window listener. The window one
  // fired at load, before the stylesheet had settled the box, and captured a
  // 300px arena that then rendered into a 358px element for the rest of the
  // session — a blurry canvas that nothing but the devicePixelRatio assertion
  // could see. The box is the thing that changes, so the box is the thing to
  // watch.
  new ResizeObserver(resize).observe(canvas);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let run = createRun();
  let started = false;
  let moves = 0;
  let pendingInputAt: number | null = null;
  // When the run stopped playing, so the win/lose effect below has a fixed
  // zero rather than recomputing "how long ago" from a moving elapsedMs.
  let outcomeAt: number | null = null;
  const FX_MS = 700;

  // The arena is square inside whatever box the layout gives it, so a
  // fraction of the arena is the same distance in x as in y. Without this a
  // circle drawn at radius r is an ellipse and, worse, the enemy that looks
  // furthest away is not.
  const box = () => {
    const side = Math.min(w, h);
    return { side, ox: (w - side) / 2, oy: (h - side) / 2 };
  };
  const px = (fx: number) => box().ox + fx * box().side;
  const py = (fy: number) => box().oy + fy * box().side;
  const ps = (f: number) => f * box().side;

  // --- input ---------------------------------------------------------------
  // One direction, however it arrives.
  const held = new Set<string>();
  let drag: { x: number; y: number } | null = null;

  function direction(): { x: number; y: number } {
    if (drag) return drag;
    let x = 0;
    let y = 0;
    if (held.has("a") || held.has("arrowleft")) x -= 1;
    if (held.has("d") || held.has("arrowright")) x += 1;
    if (held.has("w") || held.has("arrowup")) y -= 1;
    if (held.has("s") || held.has("arrowdown")) y += 1;
    return { x, y };
  }

  function noteInput(at: number): void {
    if (pendingInputAt === null) pendingInputAt = at;
    moves++;
    mirror.dataset.moves = String(moves);
  }

  canvas.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
    e.preventDefault();
    if (!held.has(k)) noteInput(e.timeStamp);
    held.add(k);
  });
  canvas.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
  canvas.addEventListener("blur", () => held.clear());

  // The whole surface is the stick: press anywhere and the player goes that
  // way relative to where the press started, so a phone needs no on-screen
  // control drawn on top of the game.
  let anchor: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.focus();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // following the finger off the canvas is a nicety, not a requirement
    }
    const r = canvas.getBoundingClientRect();
    anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    // A tap with no drag still has to do something, or a tap reads as a dead
    // surface — one nudge towards where the finger landed.
    const from = { x: px(run.player.x), y: py(run.player.y) };
    drag = { x: anchor.x - from.x, y: anchor.y - from.y };
    noteInput(e.timeStamp);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!anchor) return;
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - r.left - anchor.x;
    const dy = e.clientY - r.top - anchor.y;
    if (Math.hypot(dx, dy) > 6) drag = { x: dx, y: dy };
  });
  const lift = (e: PointerEvent) => {
    if (e.pointerId !== undefined) anchor = null;
    drag = null;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  // --- the level-up cards --------------------------------------------------
  // Icons and pips. Not one word: a card that explains itself is the
  // instruction the brief bans, and three unexplained choices are taught the
  // same way everything else here is — by taking one and seeing what changes.
  // A name and one line each. Icons alone were defensible — the brief bans
  // instructions, and three unexplained cards are learned by taking one — but
  // they made the only decision in the game a guess, and a guess is not a
  // decision. These describe what a thing does, not how to play; the opening
  // screen still has no words on it at all, which is where the rule bites.
  const CARD: Record<UpgradeId, { name: string; line: string }> = {
    speed: { name: "Fleet", line: "Move faster." },
    damage: { name: "Edge", line: "Everything you have hits harder." },
    rate: { name: "Tempo", line: "Everything you have fires more often." },
    magnet: { name: "Draw", line: "Experience is pulled in, and is worth more." },
    orbit: { name: "Orbit", line: "A shard circles you, and cuts what it touches." },
    bolt: { name: "Bolt", line: "One more bolt, at whatever is nearest." },
    nova: { name: "Pulse", line: "A shockwave, outward, on its own clock." },
  };

  const GLYPH: Record<UpgradeId, string> = {
    speed: '<path d="M20 34 L34 14 M14 34 L28 14" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
    damage: '<path d="M24 8 L30 24 L24 40 L18 24 Z" fill="currentColor"/>',
    rate: '<circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 15 V24 L31 28" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
    magnet: '<path d="M14 32 V22 a10 10 0 0 1 20 0 v10" fill="none" stroke="currentColor" stroke-width="5"/><path d="M14 32 v4 M34 32 v4" stroke="currentColor" stroke-width="5"/>',
    orbit: '<circle cx="24" cy="24" r="5" fill="currentColor"/><circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 5"/><rect x="35" y="21" width="6" height="6" fill="currentColor"/>',
    bolt: '<circle cx="12" cy="24" r="4" fill="currentColor"/><path d="M18 24 H38" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M32 18 L38 24 L32 30" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    nova: '<circle cx="24" cy="24" r="4" fill="currentColor"/><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.7"/><circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="2" opacity="0.35"/>',
  };

  function showCards(ids: UpgradeId[]): void {
    cards.replaceChildren();
    for (const id of ids) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.upgrade = id;
      const have = run.build[id];
      b.setAttribute("aria-label", `${CARD[id].name}: ${CARD[id].line} Level ${have} of ${MAX_LEVEL}.`);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 48 48");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = GLYPH[id];
      const name = document.createElement("strong");
      name.textContent = CARD[id].name;
      const line = document.createElement("em");
      line.textContent = CARD[id].line;
      const pips = document.createElement("span");
      pips.className = "pips";
      for (let i = 0; i < MAX_LEVEL; i++) {
        const pip = document.createElement("i");
        if (i < have) pip.className = "on";
        else if (i === have) pip.className = "next";
        pips.append(pip);
      }
      b.append(svg, name, line, pips);
      b.addEventListener("click", () => {
        applyUpgrade(run, id);
        cards.hidden = true;
        canvas.focus();
      });
      cards.append(b);
    }
    cards.hidden = false;
    (cards.firstElementChild as HTMLElement | null)?.focus();
  }

  // --- the verdict ---------------------------------------------------------
  function mmss(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function showVerdict(): void {
    const won = run.outcome === "won";
    verdict.className = `verdict ${won ? "won" : "lost"}`;
    verdict.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = won ? "Survived" : "Overrun";
    const dl = document.createElement("dl");
    for (const [k, v] of [
      ["Lasted", `${mmss(run.elapsedMs)} of ${mmss(RUN_MS)}`],
      ["Level", String(run.level)],
      ["Destroyed", String(run.kills)],
    ] as const) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const again = document.createElement("button");
    again.type = "button";
    again.dataset.testid = "again";
    again.textContent = "Again";
    again.addEventListener("click", restart);
    verdict.append(title, dl, again);
    verdict.hidden = false;
    again.focus();
  }

  function restart(): void {
    run = createRun();
    started = false;
    outcomeAt = null;
    verdict.hidden = true;
    canvas.focus();
  }

  // --- drawing -------------------------------------------------------------
  function ring(x: number, y: number, r: number, colour: string, width = 2): void {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function disc(x: number, y: number, r: number, colour: string): void {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(now: number): void {
    const { side, ox, oy } = box();
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // Screen shake, only for the first instant of a loss, and only when
    // motion is welcome. It decays to nothing well before the panel finishes
    // popping in, so it reads as an impact rather than an ongoing wobble.
    if (run.outcome === "lost" && outcomeAt !== null && !reducedMotion.matches) {
      const t = Math.min(1, (now - outcomeAt) / FX_MS);
      if (t < 0.4) {
        const mag = ps(0.014) * (1 - t / 0.4);
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }
    }
    ctx.fillStyle = "#0d0d12";
    ctx.fillRect(ox, oy, side, side);

    // Two bars, no numbers. The top one is the run: it fills left to right
    // over two minutes and reaching the end of it is how you win. It used to
    // be three pixels of off-white and read as decoration — somebody who had
    // played the game asked me what it was for — so it is thick, gold, and
    // the only gold thing up there. Experience is the thin blue one at the
    // bottom, a different colour because it is a different quantity.
    ctx.fillStyle = "rgb(232 178 92 / 10%)";
    ctx.fillRect(ox, oy, side, 6);
    ctx.fillStyle = "#e8b25c";
    ctx.fillRect(ox, oy, side * Math.min(1, run.elapsedMs / RUN_MS), 6);
    const need = xpForLevel(run.level);
    ctx.fillStyle = "rgb(159 208 255 / 12%)";
    ctx.fillRect(ox, oy + side - 3, side, 3);
    ctx.fillStyle = "#9fd0ff";
    ctx.fillRect(ox, oy + side - 3, side * Math.min(1, run.xp / need), 3);

    // The boss clock: a red bar under the run bar, draining. Two minutes is
    // the run; this is the much shorter one you are on while something big is
    // on the field, and running it out is how a player who never picked
    // anything up loses.
    if (run.bossDeadline !== null) {
      const left = Math.max(0, (run.bossDeadline - run.elapsedMs) / BOSS_WINDOW_MS);
      ctx.fillStyle = "rgb(224 92 92 / 15%)";
      ctx.fillRect(ox, oy + 7, side, 4);
      ctx.fillStyle = "#e05c5c";
      ctx.fillRect(ox, oy + 7, side * left, 4);
    }

    for (const o of run.orbs) {
      // Bigger and brighter when it came out of something you killed, because
      // it is worth more and the difference is the reason to go there.
      const big = o.value > 1;
      disc(px(o.x), py(o.y), ps(big ? 0.014 : 0.009), big ? "#f7cd85" : "#c9993f");
      disc(px(o.x), py(o.y), ps(big ? 0.006 : 0.0035), "#fff3dc");
    }

    // Draw's reach, once there is any. Nothing is drawn when the upgrade has
    // not been taken, because there is nothing to show: experience is picked
    // up by standing on it.
    const reach = drawRadius(run.build);
    if (reach > 0) ring(px(run.player.x), py(run.player.y), ps(reach), "rgb(232 178 92 / 16%)", 1);

    for (const e of run.enemies) {
      const r = ps(e.boss ? 0.019 + BOSS_RADIUS : 0.019);
      // A shape per kind, so what something is about to do is legible before
      // it does it. The walker is a solid diamond, the shooter is a hollow
      // ring with a dot in it — an eye — and the charger is a wedge that
      // points where it is going and flares white while it is winding up.
      ctx.fillStyle = e.hitCd > 0 ? "#c9a0a0" : e.boss ? "#b06a86" : "#8e7fa8";
      ctx.strokeStyle = ctx.fillStyle as string;
      if (e.kind === "shooter" && !e.boss) {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px(e.x), py(e.y), r, 0, Math.PI * 2);
        ctx.stroke();
        disc(px(e.x), py(e.y), r * 0.42, "#d8c2e8");
      } else if (e.kind === "charger" && !e.boss) {
        const winding = e.cd < 0.6 && !e.dash;
        const a = Math.atan2(run.player.y - e.y, run.player.x - e.x);
        ctx.fillStyle = e.dash ? "#f0e6f6" : winding ? "#c8b2dd" : "#8e7fa8";
        ctx.beginPath();
        ctx.moveTo(px(e.x) + Math.cos(a) * r * 1.7, py(e.y) + Math.sin(a) * r * 1.7);
        ctx.lineTo(px(e.x) + Math.cos(a + 2.4) * r, py(e.y) + Math.sin(a + 2.4) * r);
        ctx.lineTo(px(e.x) + Math.cos(a - 2.4) * r, py(e.y) + Math.sin(a - 2.4) * r);
        ctx.closePath();
        ctx.fill();
      } else {
      ctx.beginPath();
      ctx.moveTo(px(e.x), py(e.y) - r);
      ctx.lineTo(px(e.x) + r, py(e.y));
      ctx.lineTo(px(e.x), py(e.y) + r);
      ctx.lineTo(px(e.x) - r, py(e.y));
      ctx.closePath();
      ctx.fill();
      }
      // How much is left of it, as an arc around it. A big shape that never
      // visibly changes reads as invulnerable, and a player who thinks a
      // thing cannot be hurt stops trying to hurt it.
      if (e.boss) {
        ctx.strokeStyle = "#e05c5c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px(e.x), py(e.y), r + 6, -Math.PI / 2, -Math.PI / 2 + (e.health / e.maxHealth) * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Enemy shot. Red, because everything on this page that can take a heart
    // off you is red and nothing else is.
    for (const h of run.hazards) {
      disc(px(h.x), py(h.y), ps(0.011), "#e05c5c");
      disc(px(h.x), py(h.y), ps(0.005), "#ffd9d9");
    }

    for (const s of run.shots) {
      ctx.strokeStyle = "#9fd0ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px(s.x), py(s.y));
      ctx.lineTo(px(s.x - s.dx * 0.03), py(s.y - s.dy * 0.03));
      ctx.stroke();
    }

    if (run.build.nova > 0) {
      const t = 1 - Math.max(0, run.cooldowns.nova) / 2.6;
      ring(px(run.player.x), py(run.player.y), ps((0.10 + 0.035 * run.build.nova) * t), `rgb(159 208 255 / ${0.35 * (1 - t)})`, 3);
    }

    for (let i = 0; i < run.build.orbit; i++) {
      const a = run.orbitPhase + (i * Math.PI * 2) / run.build.orbit;
      const sx = px(run.player.x + Math.cos(a) * 0.10);
      const sy = py(run.player.y + Math.sin(a) * 0.10);
      disc(sx, sy, ps(0.014), "#9fd0ff");
    }

    const blink = run.invulnerableFor > 0 && Math.floor(now / 90) % 2 === 0;
    disc(px(run.player.x), py(run.player.y), ps(0.021), blink ? "#5b5b6b" : "#f4f1e8");

    if (!started) {
      // The whole opening screen. One orb a short walk away, and a slow ring
      // around the player that reaches out towards it. Nothing spawns and the
      // clock does not run until the orb is taken, so the first thing anybody
      // does is the thing the game is about.
      const pulse = reducedMotion.matches ? 0.5 : (Math.sin(now / 620) + 1) / 2;
      ring(px(run.player.x), py(run.player.y), ps(0.035 + pulse * 0.05), `rgb(244 241 232 / ${0.30 - pulse * 0.2})`, 2);
    }

    // The end state is a panel now, in words, so the canvas only dims behind
    // it. The wordless ring said "something happened" and left which of the
    // two things to the player. A burst or a flash on top of the dim says
    // which one before the panel's text has even faded in.
    if (run.outcome !== "playing") {
      ctx.fillStyle = "rgb(10 10 13 / 72%)";
      ctx.fillRect(ox, oy, side, side);
      ctx.fillStyle = run.outcome === "won" ? "#e8b25c" : "#e05c5c";
      ctx.fillRect(ox, oy, side * Math.min(1, run.elapsedMs / RUN_MS), 6);

      const t = outcomeAt === null ? 1 : Math.min(1, (now - outcomeAt) / FX_MS);
      const cx = px(run.player.x);
      const cy = py(run.player.y);
      if (run.outcome === "won") {
        if (reducedMotion.matches) {
          // Still obvious without anything moving: one steady ring.
          ring(cx, cy, ps(0.18), "rgb(232 178 92 / 55%)", 4);
        } else {
          for (const delay of [0, 0.15, 0.3]) {
            const rt = (t - delay) / (1 - delay);
            if (rt <= 0) continue;
            const eased = 1 - Math.pow(1 - Math.min(1, rt), 3);
            ring(cx, cy, ps(0.05 + eased * 0.55), `rgb(232 178 92 / ${(1 - eased) * 0.6})`, 3);
          }
          if (t < 0.3) {
            ctx.fillStyle = `rgb(244 241 232 / ${0.35 * (1 - t / 0.3)})`;
            ctx.fillRect(ox, oy, side, side);
          }
        }
      } else {
        if (reducedMotion.matches) {
          ctx.fillStyle = "rgb(224 92 92 / 30%)";
          ctx.fillRect(ox, oy, side, side);
        } else if (t < 0.5) {
          ctx.fillStyle = `rgb(224 92 92 / ${0.4 * (1 - t / 0.5)})`;
          ctx.fillRect(ox, oy, side, side);
        }
      }
    }
    ctx.restore();
  }

  // --- the loop ------------------------------------------------------------
  let last = performance.now();
  const rng = Math.random;

  function frame(now: number): void {
    // devicePixelRatio is not a constant. It changes when a window moves
    // between monitors, and — as the laptop viewport caught — it is not
    // necessarily what it will be at the moment the ResizeObserver first
    // fires. Cheap to check, and the alternative is a canvas that is silently
    // half resolution for the whole session.
    const dpr = window.devicePixelRatio || 1;
    const live = canvas.getBoundingClientRect();
    if (live.width > 0 && canvas.width !== Math.round(live.width * dpr)) resize();

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (pendingInputAt !== null) {
      const gap = Math.max(0, now - pendingInputAt);
      mirror.dataset.latencyPageMs = gap.toFixed(2);
      mirror.dataset.latencyMs = gap.toFixed(2);
      mirror.dataset.latencyParts = `input to frame ${gap.toFixed(1)} ms`;
      pendingInputAt = null;
    }

    const input = direction();
    if (run.outcome !== "playing") {
      if (verdict.hidden) showVerdict();
      if (input.x !== 0 || input.y !== 0) restart();
    } else if (!started) {
      // Frozen until the first orb is taken: no clock, no spawns. The field
      // already has experience lying on it, so the opening screen is a room
      // full of things worth walking to and nothing that can hurt you.
      const mag = Math.hypot(input.x, input.y);
      if (mag > 0) {
        const s = 0.30 * dt;
        run.player.x = Math.min(1, Math.max(0, run.player.x + (input.x / mag) * s));
        run.player.y = Math.min(1, Math.max(0, run.player.y + (input.y / mag) * s));
      }
      const took = run.orbs.findIndex(
        (o) => Math.hypot(o.x - run.player.x, o.y - run.player.y) < TOUCH_RADIUS,
      );
      if (took >= 0) {
        run.orbs.splice(took, 1);
        run.xp = 1;
        started = true;
      }
    } else {
      if (run.pending && cards.hidden) showCards(run.pending);
      step(run, dt, input, rng);
    }

    for (let i = 0; i < hudHearts.children.length; i++) {
      hudHearts.children[i].className = i < run.hearts ? "" : "gone";
    }
    hudLevel.textContent = `LV ${run.level}`;
    hudClock.textContent = `${mmss(run.elapsedMs)} / ${mmss(RUN_MS)}`;
    hudTally.textContent = String(run.kills);

    mirror.dataset.idleMotion = reducedMotion.matches ? "off" : "on";
    mirror.dataset.outcome = run.outcome;
    mirror.dataset.level = String(run.level);
    mirror.dataset.hearts = String(run.hearts);
    mirror.dataset.started = String(started);
    mirror.dataset.elapsed = run.elapsedMs.toFixed(0);
    mirror.dataset.kills = String(run.kills);
    mirror.dataset.xp = run.xp.toFixed(1);
    mirror.dataset.enemies = String(run.enemies.length);
    mirror.dataset.boss = run.bossDeadline === null ? "" : String(run.bossIndex);
    mirror.dataset.orbs = String(run.orbs.length);
    draw(now);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
}
