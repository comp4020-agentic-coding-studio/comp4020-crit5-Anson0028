#!/usr/bin/env node
// Real-browser assertions at both marking viewports. jsdom has no layout
// engine, so an entire class of defect — an element that says it is hidden and
// isn't, a control that sits on top of another, a canvas whose pixel buffer
// doesn't match its box — is invisible to the test suite by construction.
//
// Served over real HTTP via Vite's preview server rather than opened as a
// file:// URL: a file:// origin is opaque per-file, so a built page's
// `<script type="module" crossorigin>` and `<link crossorigin>` are
// CORS-blocked and never run. That silently happened in assignment 1 — this
// check was green for a week while measuring an empty, unstyled document.
//
// Carried forward from assignment 1 with its contract-specific assertions
// removed. What went: a liveness wait for nine range inputs, and a
// touch-drag assertion about moving a player. What stayed is everything that
// is true of any page. See CLAUDE.md — a sensor is kept and retargeted, not
// deleted, because deleting the file to remove two assertions would have
// taken four generic ones with it.
//
// Deliberately outside `pnpm check`: a browser launch is slower than the rest
// of the roster and needs `pnpm exec playwright install chromium` once.
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";


const DIST = resolve("dist");

// deviceScaleFactor matters specifically: Playwright defaults to 1, which
// makes `expected = box * devicePixelRatio` multiply by 1 and never exercise
// the term at all. 390×844 is marked under Chrome's device emulation at
// deviceScaleFactor 3 — that's the real number, not the default. In
// assignment 1 the pinned 1 hid a canvas that really did render blurry.
const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080, deviceScaleFactor: 1, hasTouch: false },
  { name: "phone", width: 390, height: 844, deviceScaleFactor: 3, hasTouch: true },
  // Not a marking viewport: a laptop window, because 1080 is a screen and a
  // browser's own furniture comes out of it before the page sees a pixel.
  { name: "laptop", width: 1280, height: 800, deviceScaleFactor: 2, hasTouch: false },
];

// UNSET until the instrument exists. When this week's prototype is on the page, point
// this at it and the canvas assertion below starts meaning something. Until
// then that assertion reports itself as unchecked rather than passing — a
// check that silently skips its own subject is the failure this whole file is
// about.
const CANVAS_SELECTOR: string | null = null;

// The phone has no keyboard, so "can this be played at all here" is a question
// only a finger can answer. In assignment 1 the touch rule sat in CLAUDE.md
// unimplemented for the entire build and the phone viewport was unplayable,
// while fifty tests looked elsewhere. This is the sensor that would have said
// so: tap the play surface, and the counter in the state mirror has to
// move. It cannot hear the sound — nothing automated can — but it can prove
// that a finger reaches the thing that makes it.
const TOUCH_TARGET: string | null = null;
const TOUCH_STATE: string | null = null;

// The counter in that mirror which has to move when the page is used. Last
// week it was a pluck counter; this week it is whatever the game increments
// when a player does the thing the game is about. UNSET, deliberately.
const TOUCH_COUNTER: string | null = null;


function htmlFiles(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

async function main(): Promise<void> {
  if (!existsSync(DIST)) {
    console.error(`✗ ${DIST} not found — run \`pnpm build\` first`);
    process.exit(1);
  }

  const pages = htmlFiles();
  if (pages.length === 0) {
    console.error(`✗ no built pages found under ${DIST}`);
    process.exit(1);
  }

  let failed = false;
  let unchecked = 0;
  const server = await preview({ preview: { port: 0 } });
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) {
    console.error("✗ preview server didn't report a URL");
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    for (const path of pages) {
      const name = relative(DIST, path);
      const url = new URL(name, baseUrl).href;
      for (const viewport of VIEWPORTS) {
        const label = `${name} @ ${viewport.name} (${viewport.width}×${viewport.height})`;
        const page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor,
          hasTouch: viewport.hasTouch,
        });

        // Both kinds of error sat in the console the whole time this script
        // was measuring a blank page in assignment 1 — nothing was listening.
        const consoleErrors: string[] = [];
        const requestFailures: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        page.on("pageerror", (err) => consoleErrors.push(`uncaught exception: ${err.message}`));
        page.on("requestfailed", (req) => {
          requestFailures.push(`${req.url()} — ${req.failure()?.errorText ?? "unknown error"}`);
        });

        function reportErrors(): void {
          for (const e of consoleErrors) console.error(`    console error: ${e}`);
          for (const r of requestFailures) console.error(`    failed request: ${r}`);
        }

        try {
          await page.goto(url, { waitUntil: "load" });

          // 1. Errors during load fail on their own. An asset that 404s or a
          // script that throws doesn't get to pass because the rest of the
          // page happened to render.
          if (consoleErrors.length > 0 || requestFailures.length > 0) {
            console.error(`✗ ${label}: errors during load`);
            reportErrors();
            failed = true;
          }

          // 2. Anything carrying `hidden` must actually be gone. Setting the
          // property is not enough: `#app section` (1,0,1) outranks a plain
          // `.thing[hidden]` (0,2,0), so an element read as hidden while
          // computing `display: flex`. That bit twice in assignment 1 — a
          // dismissed overlay that stayed on screen, then a panel visible from
          // page load that let someone score an attempt against no target.
          const stillShown = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>("[hidden]"))
              .filter((el) => getComputedStyle(el).display !== "none")
              .map((el) => `${el.dataset.testid ?? el.tagName.toLowerCase()} computes ${getComputedStyle(el).display}`),
          );
          if (stillShown.length > 0) {
            console.error(`✗ ${label}: element(s) marked hidden are still displayed — ${stillShown.join("; ")}`);
            failed = true;
            continue;
          }

          // 3. No control may sit on top of another. Assignment 1's paused
          // hint was absolutely positioned against a container that later
          // grew a button, and landed on top of it — visible in a screenshot,
          // invisible to every other check, because overflow, contrast and
          // target size were all still fine.
          const overlap = await page.evaluate(() => {
            const controls = Array.from(
              document.querySelectorAll<HTMLElement>("button, input, a[href], select, textarea"),
            ).filter((el) => el.getClientRects().length > 0);
            const hits: string[] = [];
            const name = (el: HTMLElement) => el.dataset.testid ?? el.textContent?.trim().slice(0, 20) ?? el.tagName;
            for (let i = 0; i < controls.length; i++) {
              for (let j = i + 1; j < controls.length; j++) {
                const a = controls[i].getBoundingClientRect();
                const b = controls[j].getBoundingClientRect();
                const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                // Two pixels of touching is normal for adjacent boxes;
                // covering area is not.
                if (dx > 2 && dy > 2) hits.push(`${name(controls[i])} over ${name(controls[j])}`);
              }
            }
            return hits;
          });
          if (overlap.length > 0) {
            console.error(`✗ ${label}: controls overlap — ${overlap.slice(0, 3).join("; ")}`);
            failed = true;
            continue;
          }

          // 4. Nothing overflows horizontally at either marking viewport.
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          if (scrollWidth > clientWidth) {
            console.error(`✗ ${label}: horizontal overflow — scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
            failed = true;
          } else {
            console.log(`✓ ${label}: no horizontal overflow`);
          }

          // 5. A canvas's pixel buffer must match its rendered box scaled by
          // devicePixelRatio, or it renders blurry — which is exactly what a
          // resize handler that ignores DPR looks like, and what a stale
          // buffer left over from before a resize looks like.
          if (CANVAS_SELECTOR === null) {
            unchecked++;
            console.log(`· ${label}: canvas buffer UNCHECKED — set CANVAS_SELECTOR once this week's prototype exists`);
          } else {
            const m = await page.evaluate((sel) => {
              const canvas = document.querySelector<HTMLCanvasElement>(sel);
              if (!canvas) return null;
              const rect = canvas.getBoundingClientRect();
              return {
                bufferWidth: canvas.width,
                bufferHeight: canvas.height,
                boxWidth: rect.width,
                boxHeight: rect.height,
                dpr: window.devicePixelRatio,
              };
            }, CANVAS_SELECTOR);
            if (!m) {
              console.error(`✗ ${label}: CANVAS_SELECTOR "${CANVAS_SELECTOR}" matched nothing`);
              failed = true;
            } else {
              const expectedWidth = Math.round(m.boxWidth * m.dpr);
              const expectedHeight = Math.round(m.boxHeight * m.dpr);
              const TOLERANCE_PX = 1; // the rendered box is itself sub-pixel
              if (
                Math.abs(m.bufferWidth - expectedWidth) > TOLERANCE_PX ||
                Math.abs(m.bufferHeight - expectedHeight) > TOLERANCE_PX
              ) {
                console.error(
                  `✗ ${label}: canvas pixel buffer ${m.bufferWidth}×${m.bufferHeight} doesn't match its rendered box ` +
                    `${m.boxWidth}×${m.boxHeight} at devicePixelRatio ${m.dpr} (expected ~${expectedWidth}×${expectedHeight})`,
                );
                failed = true;
              } else {
                console.log(`✓ ${label}: canvas buffer matches rendered box`);
              }
            }
          }

          // 6. The phone has no keyboard, so a finger is the only way in.
          if (viewport.hasTouch && !(TOUCH_TARGET && TOUCH_STATE && TOUCH_COUNTER)) {
            console.error(
              `✗ ${label}: touch UNCHECKED — TOUCH_TARGET/TOUCH_STATE/TOUCH_COUNTER are unset, so nothing ` +
                `here proves a finger can play this. Point them at the game and its state mirror.`,
            );
            failed = true;
          } else if (viewport.hasTouch && TOUCH_TARGET && TOUCH_STATE && TOUCH_COUNTER) {
            const head = await page.locator(TOUCH_TARGET).boundingBox();
            if (!head) {
              console.error(`✗ ${label}: nothing to touch — "${TOUCH_TARGET}" matched no box`);
              failed = true;
              continue;
            }
            const before = Number(
              (await page.locator(TOUCH_STATE).getAttribute(TOUCH_COUNTER)) ?? "-1",
            );
            await page.touchscreen.tap(head.x + head.width * 0.5, head.y + head.height * 0.5);
            await page.waitForTimeout(120);
            const after = Number((await page.locator(TOUCH_STATE).getAttribute(TOUCH_COUNTER)) ?? "-1");
            if (!(after > before)) {
              console.error(`✗ ${label}: a tap on the play surface did nothing (${before} -> ${after})`);
              reportErrors();
              failed = true;
              continue;
            }
            console.log(`✓ ${label}: a finger can reach the mechanic`);
          }
          // 9. The crit for this brief "centers on latency, expressive gesture
          //    and feel". CLAUDE.md has claimed since the first commit that
          //    the pointer-to-sound gap is measured rather than assumed, and
          //    until now nothing measured it — the claim was decoration.
          //
          //    The page reports the whole gap it can see, in three parts: the
          //    time from the pointer event to the code that handles it, the
          //    lead the note is scheduled with, and the output latency the
          //    AudioContext admits to.
          //
          //    The ceiling is on the first two only. My first version put 30
          //    ms across the total and passed at 27, but 24 of those 27 were
          //    headless Chromium's dummy output device — so the assertion was
          //    grading the CI machine's sound card and would have gone red for
          //    something I cannot fix and green while I made the page slower.
          //    Eight milliseconds across the part the page owns catches my
          //    regressions; the total is printed beside it because that is
          //    what the player's ear actually gets.
          if (!(CANVAS_SELECTOR && TOUCH_STATE)) {
            console.error(
              `✗ ${label}: latency UNCHECKED — CANVAS_SELECTOR/TOUCH_STATE are unset. This brief is judged ` +
                `on how the game feels under the hand; nothing here measures that yet.`,
            );
            failed = true;
          } else {
            const box = await page.locator(CANVAS_SELECTOR).boundingBox();
            if (!box) {
              console.error(`✗ ${label}: no canvas to measure latency against`);
              failed = true;
            } else {
              let worst = 0;
              for (let i = 0; i < 5; i++) {
                await page.mouse.click(box.x + box.width * (0.2 + i * 0.14), box.y + box.height * 0.5);
                await page.waitForTimeout(60);
                worst = Math.max(
                  worst,
                  Number((await page.locator(TOUCH_STATE).getAttribute("data-latency-ms")) ?? NaN),
                );
              }
              const parts = (await page.locator(TOUCH_STATE).getAttribute("data-latency-parts")) ?? "?";
              const mine = Number((await page.locator(TOUCH_STATE).getAttribute("data-latency-page-ms")) ?? NaN);
              if (!Number.isFinite(worst) || !Number.isFinite(mine)) {
                console.error(`✗ ${label}: the page reports no input-to-response latency at all`);
                failed = true;
              } else if (mine > 8) {
                console.error(
                  `✗ ${label}: the page spent ${mine.toFixed(1)} ms of its own between hand and sound ` +
                    `(total ${worst.toFixed(1)} ms: ${parts})`,
                );
                failed = true;
              } else {
                console.log(
                  `✓ ${label}: the page's own share of the gap is ${mine.toFixed(1)} ms ` +
                    `(total ${worst.toFixed(1)} ms: ${parts})`,
                );
              }
            }
          }

          // 10. Markers resize the window mid-interaction. A canvas instrument
          //     is the worst case for that: the drawing buffer, the CSS box
          //     and the pointer maths all have to agree again afterwards, and
          //     whatever is in flight has to survive the change.
          if (!(CANVAS_SELECTOR && TOUCH_STATE && TOUCH_COUNTER)) {
            console.error(`✗ ${label}: resize UNCHECKED — CANVAS_SELECTOR/TOUCH_STATE/TOUCH_COUNTER are unset`);
            failed = true;
          } else {
            const box = await page.locator(CANVAS_SELECTOR).boundingBox();
            if (!box) {
              console.error(`✗ ${label}: no canvas to resize around`);
              failed = true;
            } else {
              await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
              await page.setViewportSize({ width: Math.round(viewport.width * 0.7), height: viewport.height });
              await page.waitForTimeout(150);
              const before = Number((await page.locator(TOUCH_STATE!).getAttribute(TOUCH_COUNTER!)) ?? "-1");
              const after = await page.locator(CANVAS_SELECTOR!).boundingBox();
              // A real pointer, not a synthesised PointerEvent: the first
              // version of this dispatched its own event with a made-up
              // pointerId, setPointerCapture threw NotFoundError for a pointer
              // the browser had never seen, and the check went red against a
              // page that was fine. The bug was in the sensor, and a sensor
              // that cries wolf gets ignored, which is worse than not having
              // it. (The throw is guarded now anyway — see main.ts.)
              if (after) await page.mouse.click(after.x + after.width * 0.7, after.y + after.height * 0.4);
              const now = Number((await page.locator(TOUCH_STATE!).getAttribute(TOUCH_COUNTER!)) ?? "-1");
              const dpr = await page.evaluate(() => window.devicePixelRatio);
              const buffer = await page.evaluate((sel) => {
                const el = document.querySelector<HTMLCanvasElement>(sel as string)!;
                return { w: el.width, h: el.height };
              }, CANVAS_SELECTOR);
              await page.setViewportSize({ width: viewport.width, height: viewport.height });
              const drift = after ? Math.abs(buffer.w - after.width * dpr) : Infinity;
              if (now <= before) {
                console.error(`✗ ${label}: the page stopped answering after a resize mid-interaction`);
                failed = true;
              } else if (drift > 2) {
                console.error(
                  `✗ ${label}: after a resize the canvas buffer is ${buffer.w}px for a ${after!.width}px box ` +
                    `at dpr ${dpr} — off by ${drift.toFixed(1)}`,
                );
                failed = true;
              } else {
                console.log(`✓ ${label}: a resize mid-interaction leaves the page playable and in register`);
              }
            }
          }

          // 11. The whole play surface has to be on screen without scrolling,
          //     and big enough to use. A game you have to scroll to see is a
          //     game whose edges you cannot reach without losing sight of it,
          //     and last week a phone got 239px of a control that needed 500 —
          //     a defect no other assertion here could see.
          //
          //     The marking viewports are 1920×1080 and 390×844, but 1080 is a
          //     screen and not a window — Chrome's own furniture comes out of
          //     it — so a laptop-sized 1280×800 is checked as well.
          if (!CANVAS_SELECTOR) {
            console.error(`✗ ${label}: fits-on-screen UNCHECKED — CANVAS_SELECTOR is unset`);
            failed = true;
          } else {
            const fits = await page.evaluate((sel) => {
              const c = document.querySelector(sel as string)!.getBoundingClientRect();
              return { top: c.top, bottom: c.bottom, height: c.height, viewport: window.innerHeight };
            }, CANVAS_SELECTOR);
            if (fits.bottom > fits.viewport) {
              console.error(
                `✗ ${label}: the play surface runs ${(fits.bottom - fits.viewport).toFixed(0)}px past the bottom of the ` +
                  `viewport — you have to scroll to see the instrument`,
              );
              failed = true;
            } else if (fits.height < 280) {
              console.error(
                `✗ ${label}: the play surface is only ${fits.height.toFixed(0)}px tall — too small to play in`,
              );
              failed = true;
            } else {
              console.log(`✓ ${label}: the whole play surface is on screen, ${fits.height.toFixed(0)}px of string to play`);
            }
          }
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>((res, rej) => server.httpServer.close((err) => (err ? rej(err) : res())));
  }

  // Unchecked assertions are reported, never silently skipped: a check that
  // quietly stops examining its subject looks exactly like a check that
  // passed, which is the failure this repo has met more than any other.
  if (unchecked > 0) {
    console.error(`\n✗ ${unchecked} assertion(s) are UNCHECKED and must be wired before this file means anything`);
    failed = true;
  }

  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
