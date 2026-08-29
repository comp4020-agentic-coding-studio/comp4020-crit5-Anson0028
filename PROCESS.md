# Process overview

## What I built

A two-minute survival run where the only thing you ever do is decide where to
stand. Shards circle your own body and kill what touches them, so attacking is
walking towards; the experience they leave drops where the fighting was, so
getting stronger means going back into it. Every level offers three cards — an icon, a
name, one line, and five pips. The opening screen has no words on it at all:
experience already lying on the field, the clock stopped, and nothing spawning
until you pick a piece up.

## The moments that mattered

**Three of the seven cards were doing nothing, and no player could have known.**
The rules are a pure module, so a run finishes in milliseconds and the pool can
be measured. It reported damage at 0.5s *worse* than never levelling, and rate
and reach at noise — my damage model was per second of contact, so spinning
faster swept each enemy more often for proportionally less time and the
attack-rate card was worth exactly zero
([`a0c4de2...4b36c32`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Anson0028/compare/a0c4de2...4b36c32)). Fixing that exposed the
measurement as wrong twice more: it had no way to decline a card, and then
"take only this" was a rigged question for the card whose value is reaching the
next card sooner. Worst of all the simulated player had no reaction time and
won every run on every build, so the comparison saturated and could not tell
its subjects apart. Giving it 150ms and a wobble separated all seven
([`c34ed0b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Anson0028/commit/c34ed0b)).

**Then I stood still and killed nothing.** Six seconds, no kills: the shard was
a point hitting about one enemy in five. No headless run could see it, because
a simulated player is always moving and a moving player sweeps the shard across
things ([`bfee9c7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Anson0028/commit/bfee9c7)).
