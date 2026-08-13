# atlas-reactor-reference.md — Source research on Atlas Reactor (Designer)

**What this is.** Cards is inspired by Atlas Reactor (Trion Worlds, 2016; servers shut
down 28 June 2019). This document collects what the surviving public record says about
AR's character skills, map design, and gameplay, and maps each finding onto Cards'
current spec so we scaffold deliberately rather than by memory.

**Sourcing caveat — read before quoting numbers.** The game is dead and the official
site is gone; almost everything below comes from the fan wiki, community guides, and
press coverage (links in §9). Structural rules (phase order, action economy, energy
cap, role split) are corroborated across several sources and can be trusted. Specific
per-ability numbers (damage, cooldowns, HP) are patch-dependent and mostly
**unverifiable today** — treat every number in §3.4 as an *order of magnitude*, not a
balance target. Cards' own numbers live in `data/` and are settled by playtest, never
by "AR did it this way".

Nothing here changes the spec. Where AR and `docs/GAME_SPEC.md` disagree, the spec
wins until a ruling is logged in `docs/DECISIONS.md`. Divergences are catalogued in §7.

---

## 1. The turn: Decision → Resolution

AR ran on **simultaneous turns**. Every turn is a Decision Mode where all eight players
plan at once in secret, then a Resolution Mode where the whole board executes at once.
There is no initiative order, no "who goes first" — the phase pipeline *is* the
tiebreaker system.

- **Decision Mode: 20 seconds.** An audible tick accelerates as the clock runs down;
  whatever is selected at zero gets locked in automatically.
- **Time Bank: twice per match.** Failing to lock in before zero spends a bank charge
  and adds **+5 seconds** for that player only.
- **Resolution Mode: four phases, always in this order — Prep → Dash → Blast → Move.**
  Within a phase everything is computed simultaneously, but *rendered* sequentially so
  a human can read what happened. A Freelancer who dies in a phase still visibly
  completes the action they had locked in for that phase ("a character seen dying
  before their action will remain standing until it is completed").

### 1.1 What lives in each phase

| Phase | Contents | Why it matters |
|---|---|---|
| **Prep** | Traps, shields, buffs, debuffs, stances — anything that must exist *before* damage | The commitment phase: you pay a turn now for value later |
| **Dash** | Dashes, charges, evades; some deal damage | The dodge phase: this is where you leave the square a Blast is aimed at |
| **Blast** | Shooting, blasting, all stationary attacks; **displacement (knockback/pull) resolves at the end of the phase, after damage** | The trade phase: most damage happens here |
| **Move** | Ordinary walking, after everything else | The repositioning phase: you move *knowing* nothing else can react this turn |

Two consequences that AR's whole mind-game rests on, and that Cards already copies:

1. **Dash beats Blast.** A Blast is free-aimed at squares chosen during Decision. If
   the target dashed away in the earlier phase, the Blast hits empty ground. Aiming at
   where someone *will be* — not where they are — is the core skill.
2. **Displacement beats Move.** Knockback/pull applies at the end of Blast and
   **cancels the victim's Move entirely**, so a knockback both relocates them and
   strips their escape. Community guides call knockback "the hardest form of crowd
   control" for exactly this reason, and pair it with traps: shove someone into a mine
   they had no chance to walk around.

---

## 2. Action economy

The economy is deliberately tiny — one meaningful choice plus positioning per turn:

- **One ability + move up to 4 squares**, or
- **No ability + Sprint up to 8 squares.**
- **Most dashes forbid a Move-phase move** (you already moved, in Dash). Some kits
  have dashes that explicitly allow moving afterwards — that exception is a *designed
  privilege* of specific characters, not the default.
- **Free actions** are the third lever: abilities flagged *Free* cost no action at all.
  You may fire a free action **and** another ability, or a free action **and** a
  Sprint. Su-Ren's team heal being a free action is what makes an otherwise modest heal
  a defining kit feature.

Design read: the interesting number isn't damage, it's **how many of the turn's slots
an ability eats**. Free actions, dashes-that-allow-move, and Sprint-range abilities are
all the same currency — action economy — and AR balanced characters mostly by spending
that currency differently, not by moving damage numbers around.

---

## 3. Character skills (Freelancers)

### 3.1 Kit anatomy — five slots, always the same shape

Every one of AR's ~33 Freelancers had exactly five abilities:

| Slot | Rule | Notes |
|---|---|---|
| 1 — **Basic** | **No cooldown, usable every turn**, always offensive | The kit's floor: what you do when everything else is down |
| 2–4 — **Cooldown abilities** | Attacks, dashes, heals, shields, traps, buffs | The kit's identity lives here |
| 5 — **Ultimate** | Costs energy (typically the full **100**), consumes it all | The kit's ceiling; usually its most dramatic play |

Cards already matches this exactly: 4 abilities + 1 ultimate, first ability at
`cooldown: 0`, ult at 100 energy (`data/characters/*.json`).

### 3.2 Energy

- Cap **100**; overflow is wasted.
- **+5 passive per turn**, plus energy from using abilities — offensive *and*
  defensive ones both pay.
- **A missed offensive ability pays nothing.** Energy rewards connecting, which quietly
  punishes spraying abilities at squares you don't believe in.
- A handful of Freelancers gained energy from *taking* damage (a tank-flavoured
  income stream).
- The Energy power-up grants **Energized: +50% ability energy for 2 turns**.

The ult economy is therefore roughly: passive alone = 20 turns to an ult; a competent
turn of connecting abilities pulls that to ~7–10. Ults are a mid-game event you build
toward, not a per-fight resource.

### 3.3 Roles

Three roles, and AR's matchmaking/team-building convention was one of each plus a flex
in 4v4:

| Role | HP band (fan-wiki figures) | Job | Common utility |
|---|---|---|---|
| **Firepower** | ~120–160 (lowest) | Primary damage from safety | Dash is the most common utility by far, then stealth, then lifesteal/shields |
| **Frontliner** | ~160–200 (highest) | Body-block, bully, absorb | Damage mitigation, and the most movement-disrupting effects (knockback, pull, root) |
| **Support** | mid | Heals, shields, mitigation | Buffs, debuffs, CC; still has real damage |

Note the utility distribution — it's the most reusable finding in this document.
**Everyone gets an escape or a threat-of-escape; what differs is what it costs them.**
Firepowers buy safety with a dash; Frontliners buy it with HP and mitigation; Supports
buy it with allied cover and positioning.

### 3.4 Representative kits (illustrative structure, not balance data)

- **Lockwood (Firepower).** *Trick Shot* — basic single-target shot that **bounces off
  up to two walls** (turns map geometry into a weapon: he can shoot around corners that
  legally block everyone else). *Backup Plan* — a long-cooldown dash (reported ~7 turns)
  whose cooldown ticks faster when he takes damage. *Run and Gun* (ult) — dashes across
  the map damaging everything within ~3 squares of the path.
- **Rampart (Frontliner).** Dashes to a spot and **plants a deployable shield that
  behaves exactly like a wall**: "anything a wall would stop, the shield will; if a wall
  won't stop it, the shield won't." One rule, no special cases — a model worth copying
  whenever we add terrain-creating abilities.
- **Su-Ren (Support).** *Serenity* — 360° AoE heal, ~3-turn cooldown, **free action**,
  heals her too, so it's never dead. *Shifting Winds* — a dash that damages if aimed at
  an enemy or heals if aimed at an ally, usable two turns running but **must alternate
  target type**. *Karmic Justice* (ult) — a large shield that detonates next turn for
  damage scaled by how much it absorbed.

The pattern across all three: each kit has exactly one idea (geometry, deployable wall,
alternating support-dash) and the other abilities exist to set that idea up.

### 3.5 Customization (not in Cards, catalogued for later)

- **Mods:** per-ability modifiers chosen out of match — cooldown reduction, self-heal
  on use, more/less energy. A shallow, readable build layer on a fixed kit.
- **Catalysts:** three per match, **one Prep, one Dash, one Blast**, each chosen from
  four options, each usable **once per match**, and only one catalyst per turn.
  Examples: *Brain Juice* (all cooldowns −1 turn), *Critical Shot*, *Second Wind*,
  *Regenergy* (Prep); *Shift*, *Fetter*, *Fade*, *Regroup* (Dash); *Adrenaline*,
  *Probe*, *Echo Boost*, *Chronosurge* (Blast).

Catalysts are the single best-value idea AR had for a game like Cards: they add a
per-match resource and a bluff layer, they slot cleanly into the existing phase
pipeline, and they are trivially deterministic (a fixed list, once each, no RNG).

---

## 4. Combat rules worth copying exactly

- **Cover: −50% damage from the covered direction** (a few attacks are only reduced
  25%), granted against attacks arriving from the cover's front **and ~45° to either
  side**. Adjacent attackers ignore it: "being next to a wall reduces damage taken from
  that direction by 50%, unless the attacker is also adjacent to you."
- **Walls block vision, most attacks, and most projectiles**, and most ground dashes
  stop at them. Walls are the map's hard constraint; cover is the soft one.
- **Ground vs. airborne dashes.** Ground dashes **trigger traps and lingering ground
  effects** and are stopped by walls. Airborne dashes **skip both** — no trap triggers,
  and they can cross walls. This is a clean, data-only flag that makes two dashes with
  identical range feel completely different.
- **Traps are ally-safe.** You can deliberately run your own team through your team's
  traps; only enemies trigger them. Combined with knockback/pull, traps are the
  punishment for predictable movement.
- **Blocking for a teammate.** Dashing into the path of a shot aimed at an ally is a
  legitimate save — bodies are terrain in the Blast phase.
- **Chase.** Right-clicking an enemy issues a *chase* instead of a fixed path: you move
  toward wherever they ended up, and chasers resolve **at the end of the Move phase**.
  It's the answer to "I can't path to a square I can't predict."
- **Information.** Enemy positions are broadly known; what's hidden is *intent*. The
  exceptions are camouflage areas and Invisible: an invisible Freelancer can't be seen,
  but **acting from concealment gives away the position** (you see the action's origin,
  not the movement), and casting from a cloak area disables that area for a turn.

---

## 5. Map design

AR shipped few maps and leaned on them hard — roughly **Cloudspire, Flyway Freighter,
EvoS Labs, Omni Reactor Core** (plus Hyperforge and seasonal reskins like a snowed-in
Cloudspire). Maps are **mostly symmetrical**, dense with cover, and explicitly built
"with lots of stuff to hide behind and plenty of ways to trap, track, or outsmart
opponents."

### 5.1 The shipped maps as archetypes

| Map | Character | Who it favors |
|---|---|---|
| **EvoS Labs** | Large; many walls, cover, **narrow corridors**; positioning-critical | Frontliners, trap/CC kits, wall-bounce geometry |
| **Flyway Freighter** | Large; **wide open spaces** plus a handful of large camouflage hideaways | Long-range Firepower; ambush kits using the hideaways |
| **Omni Reactor Core** | **Lots of low cover, wide open, camouflage everywhere but no true hiding**; you're never far from a fight | Brawlers; punishes slow setup |
| **Cloudspire** | High-rise skygarden; **narrow passages**, cover, camouflage at both ends — built for "interesting dashes and trick shots" | Dash/mobility kits |

Read as a set, these are four *deliberately different answers* to one question: how far
apart can the teams be? Corridors (EvoS) force engagement geometry; open ground
(Flyway) makes range king; low cover (Omni) makes range irrelevant but positioning
constant.

### 5.2 Power-ups — the map's clock

- Power-ups spawn **only at fixed, color-coded pads, on a timer**, and every map has
  its own pad layout.
- Types: **Health** (10 healing on pickup, +20 more over 2 turns), **Might** (+25%
  damage, 2 turns), **Energy** (Energized: +50% ability energy, 2 turns).
- Each type has a **minor variant** lasting a single turn.

This is the mechanism that keeps a symmetric map from being a stalemate: fixed pads on
a fixed schedule create contested squares at predictable times, so the map itself
generates fights without any RNG. It's fully deterministic and would drop into Cards'
engine without violating any golden rule.

### 5.3 Checklist for authoring Cards maps

Distilled from the above, applied to our 15×15 `data/maps/*.json` format:

1. **Symmetry by default.** Rotational or mirror; asymmetry is a balance liability we
   can't afford before we have telemetry.
2. **Give each map one thesis** (corridor / open / low-cover brawl) and let the cover
   density carry it. Don't average them into mush.
3. **Budget sightlines against our longest range.** Vex's basic reaches 8 and his ult is
   map-length; a map with a clean 15-square lane hands him a free kill every turn it
   isn't blocked. Break every lane longer than ~8 with a wall.
4. **Walls for shape, cover for texture.** Walls define the map's rooms and LoS; cover
   defines whether a square is worth standing on. Our `duel-arena` currently runs 8
   walls / 10 cover / 8 brush on 225 squares — that's the low end of "dense with cover".
5. **Escape geometry near spawns.** Respawning into an open lane is a free kill for the
   team that's already ahead.
6. **Reserve pad squares now**, even before power-ups exist — a `powerups: []` field
   costs nothing and stops every map needing a redraw later.

---

## 6. Match structure and modes

| Mode | Rules |
|---|---|
| **Standard (Deathmatch)** | 4v4. 1 point per kill; **first to 5**, or most points after **20 turns**. A tie extends the game turn by turn until it isn't a tie. |
| **Extraction / Objective** | A case spawns mid-map. 2 points per kill, 1 per turn your team holds the case; at 10 points an extraction zone appears — deliver the case to win. |
| **Overpowered-Up** | Race to **8 kills**; **20 energy/turn** instead of 5; all damage, healing and shielding **+50%**; fast, less-fair respawns (you return "one sprint away from the action", auto-placed). |

The Overpowered-Up recipe is a good template for a Cards party/practice mode: same
engine, three constants changed, no new rules.

---

## 7. Cards vs. Atlas Reactor — what we inherit, what we changed

| System | Atlas Reactor | Cards (`GAME_SPEC.md`) | Status |
|---|---|---|---|
| Phase order | Prep → Dash → Blast → Move | identical | ✅ inherited |
| Simultaneous, hidden planning | yes | yes, hidden team-vs-team | ✅ inherited |
| Movement | 4 with ability / 8 sprint | 4 / 8 | ✅ inherited |
| Dash forbids Move | yes (with kit exceptions) | yes | ✅ inherited |
| Displacement cancels Move | yes, resolves end of Blast | yes | ✅ inherited |
| Kit shape | basic (no CD) + 3 CD + ult | identical | ✅ inherited |
| Energy | cap 100, +5/turn, ult = 100, no energy on a miss | identical | ✅ inherited |
| Roles | Firepower / Frontline / Support | same three + two hybrids (`roster-v1.md`) | ✅ extended |
| Team size | 4v4 | **2v2 default**, 4v4 supported | ⚠️ deliberate |
| Kill target / turn limit | 5 / 20 | 4v4: 5 / 20; 2v2: 4 / 16 | ✅ inherited |
| Decision timer | 20 s, Time Bank 2× **+5 s** | 30 s, Time Bank 1× **+10 s** | ⚠️ deliberate (we plan for 2 characters/player) |
| Cover | −50% (some 25%) over a ~45° arc; ignored by adjacent attacker | −50% flat, orthogonal adjacency, directional; ignored at range ≤ 1 | ⚠️ simplified — grid-exact and deterministic; keep |
| Vision | positions broadly known; concealment = camouflage/Invisible | **6-square vision + brush**, team-shared | ❓ real divergence — see below |
| Free actions | yes, a core balancing lever | **none** — every ability costs the turn's action | ❓ open |
| Ground vs airborne dashes | distinct: traps + walls | all dashes trigger traps; dashes pass through characters (MV1) | ❓ open |
| Power-ups | timed pads, 3 types + minor variants | none | ❓ candidate |
| Catalysts / mods | 3 catalysts (1 per phase, once each) + per-ability mods | none | ❓ candidate |
| Chase order | right-click chase, resolves last in Move | none — fixed paths only | ❓ candidate |
| Wall-bounce shots | Lockwood's basic | none | ❓ candidate (needs an engine shape) |

### The vision divergence is the one to think hardest about

AR hides **intent**, not **position**. You know exactly where all eight enemies stand;
the entire game is guessing what they will do about it. Cards' 6-square vision hides
position too, which changes the game's texture in ways worth stating out loud:

- **Cost:** reads become guesses. If I can't see you, aiming at where you'll be is a
  coin flip rather than a deduction, and a coin flip feels like RNG in a game whose
  whole pitch is "no RNG".
- **Benefit:** scouting, brush ambushes, and the Phantom/stealth archetype get real
  jobs, and 2v2 on a 15×15 board has fewer bodies to track — total visibility might
  make small formats feel static.

Recommendation: **keep it for 2v2, but treat map vision as a per-format tunable** and
playtest a full-visibility variant early. If reads stop feeling earned, this is the
first constant to move — before touching damage.

---

## 8. Candidate work items (for the Analyzer to triage into `BACKLOG.md`)

Ordered by value-per-unit-of-engine-risk. None of these are approved; none change
current behavior.

1. **`free: true` ability flag.** AR's cheapest balance lever, and our roster already
   wants it (Lumen's heal, Thorn's veil). Engine: exempt the ability from the
   one-action rule and from the sprint lockout. Small, data-driven, high impact.
2. **`airborne: true` dash flag.** Ignores traps and (optionally) walls. Turns our
   near-identical teleports/dashes into distinct tools for one boolean.
3. **Power-up pads.** `powerups: [{x, y, type, firstTurn, everyTurns}]` in map data,
   resolved at a fixed point in the Move phase. Deterministic, gives symmetric maps a
   heartbeat, and reuses the existing `heal`/`might`/`energized` effects — no new
   effect kinds.
4. **Two more maps** built to the §5.3 checklist: one corridor map (EvoS-like), one
   open map (Flyway-like), to sit alongside the current mixed `duel-arena`.
5. **Catalysts.** One Prep / one Dash / one Blast, once each per match, one per turn.
   Adds a bluff layer and per-match resource management without touching kits.
6. **Chase orders.** Resolve after all normal Move-phase movement. Needs an
   edge-cases ruling for chase-vs-chase and chase-into-occupied-square.
7. **Bounce/reflect line shape.** Lockwood's signature; the highest engine cost on this
   list (new geometry in the shape resolver) — worth it only once maps have enough
   walls to bounce off.

---

## 9. Sources

Primary structural claims are corroborated across at least two of these. The Atlas
Reactor fan wiki could not be fetched directly from this environment (egress policy),
so wiki content below was read through search-result extracts.

- [Phases | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Phases)
- [Movement | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Movement)
- [Abilities | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Abilities)
- [Energy | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Energy)
- [Cover | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Cover)
- [Power-ups | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Power-ups)
- [Catalyst | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Catalyst)
- [Game Modes | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Game_Modes)
- [Freelancers | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Freelancers)
- [Invisible | Atlas Reactor Wiki](https://atlas-reactor.fandom.com/wiki/Invisible)
- [Lockwood](https://atlas-reactor.fandom.com/wiki/Lockwood) · [Rampart](https://atlas-reactor.fandom.com/wiki/Rampart) · [Su-Ren](https://atlas-reactor.fandom.com/wiki/Su-Ren) | Atlas Reactor Wiki
- [EvoS Labs](https://atlas-reactor.fandom.com/wiki/EvoS_Labs) · [Flyway Freighter](https://atlas-reactor.fandom.com/wiki/Flyway_Freighter) · [Cloudspire](https://atlas-reactor.fandom.com/wiki/Cloudspire) · [Omni Reactor Core](https://atlas-reactor.fandom.com/wiki/Omni_Reactor_Core) | Atlas Reactor Wiki
- [Atlas Reactor — Wikipedia](https://en.wikipedia.org/wiki/Atlas_Reactor)
- [Atlas Reactor/Freelancer — NamuWiki](https://en.namu.wiki/w/Atlas%20Reactor/Freelancer)
- [Strategy Gaming / Atlas Reactor Dictionary — Tiggarius on Gaming](https://tiggarius.com/2017/07/18/strategy-gaming-atlas-reactor-dictionary/)
- [An Analysis of Atlas Reactor — General Store's Lab](https://generalstoreslab.wordpress.com/2016/10/04/an-analysis-of-atlas-reactor/)
- [11 Tips To Ensure Victory in Atlas Reactor — GodisaGeek](https://www.godisageek.com/2016/06/11-tips-for-atlas-reactor/)
- [Atlas Reactor Bluffing Tactics Guide — MMOsite](http://feature.mmosite.com/content/2016-01-28/atlas_reactor_bluffing_tactics_guide.shtml)
- [Atlas Reactor Introduces New Map EvoS Lab — MMOBomb](https://www.mmobomb.com/news/atlas-reactor-introduces-new-map-evos-lab)
- [Atlas Reactor Game Review — MMOs.com](https://mmos.com/review/atlas-reactor)
- [Atlas Reactor is an unusual, turn-based multiplayer tactics game — PC Gamer](https://www.pcgamer.com/atlas-reactor-is-an-unusual-turn-based-multiplayer-tactics-game/)
- [Getting Started with Atlas Reactor — Live Love Play](https://www.iliveloveplay.com/2017/02/13/getting-started-atlas-reactor/)
- [Atlas Reactor Review — MMOHuts](https://mmohuts.com/news/atlas-reactor-review)
- [Characters in Atlas Reactor — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Characters/AtlasReactor)
