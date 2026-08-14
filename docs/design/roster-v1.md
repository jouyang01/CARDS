# roster-v1.md — Launch roster design (Designer)

Status: **DRAFT for playtest**. Numbers live in `data/characters/*.json`; this doc
explains intent, archetype contracts, and balance reasoning. Where a kit needs an
engine capability that doesn't exist yet, it is marked `ENGINE ASK` in §9 — the
Builder must not invent semantics for those.

Supersedes the three-character target list in GAME_SPEC §8 (which delegates roster
refinement to this directory). Reverses the 2026-08-11 "No Support at launch"
decision at the project owner's direction — see DECISIONS.md 2026-08-12 (Designer).

## 1. Kit structure (every character, no exceptions)

Every character has **5 abilities** that fill the spec's `4 abilities + 1 ultimate`
schema:

| Slot | Count | Rules |
|---|---|---|
| **Auto attack** | 1 | `cooldown: 0`, `phase: blast`. The default turn. |
| **Skills** | 3 | `cooldown ≥ 2`. Across the 3 skills, at least **two distinct phases** (prep/dash/blast) must appear. |
| **Ultimate** | 1 | `cooldown: 0`, costs `ULT_COST` (100 energy, engine-level). Any phase. |

## 2. Archetypes

Three archetypes. Every character belongs to exactly one (hybrids carry a primary
archetype in data and a hybrid tag in this doc, §7).

### Firepower — the damage engine

Main source of team damage; lowest HP band. The low pool is offset by **exactly one
signature survival tool** per kit — a dash, stealth, or a shield (life steal is
deliberately excluded in v1; no engine effect exists and shields/dashes cover the
need). Range profiles vary across the archetype: Vex is long, Kestrel mid, Wisp
melee. Firepowers may use traps (set in Prep, trigger on entry in any phase).

**Contract:** maxHp 85–95 · auto 22–26 dmg · one escape/mitigation skill · at
least one ability with range ≥ 6 or a gap-closer.

### Frontline — the bully

Big HP pools pushed into the middle of the enemy formation. Primary damage is
close range (range ≤ 2 melee autos that ignore cover); every Frontline has a
**damage-dealing dash** and at least one movement-hindering tool (knockback, pull,
slow, root) plus one mitigation tool (shield or self-heal).

**Contract:** maxHp 120–140 · auto 20–24 dmg at range ≤ 2 · damaging dash ·
≥ 1 displacement or hard-CC effect · ≥ 1 shield/heal.

### Support — the enabler

Healing, shielding, buffs for allies; debuffs for enemies. Deals real damage —
autos land 16–18 — but less than the other archetypes because the ability slot
spent helping a teammate is the cost. **1v1 viability rule:** every beneficial
effect a Support has must be self-applicable (aimed circles include the caster's
own square; `self`/`square` shapes work alone), so a solo Support converts its
support budget into sustain and wins by attrition and debuff trades, not burst.

**Contract:** maxHp 100–110 · auto 16–18 dmg · ≥ 1 heal or shield usable on self
· ≥ 1 enemy debuff · one escape or control tool.

## 3. Themes (named sub-identities within archetypes)

Themes are how two characters in the same archetype play nothing alike. Each
character carries exactly one theme name; no two characters share one.

| Theme | Archetype | Identity | v1 character |
|---|---|---|---|
| **Sharpshooter** (lane/trap control) | Firepower | Long lines, delayed zones, traps; wins on prediction | Vex |
| **Phantom** (stealth) | Firepower | Melee burst from concealment; feast-or-famine | Wisp |
| **Skirmisher** (movement) | Firepower | Mid-range hit-and-run; the dash is also the poke | Kestrel |
| **Anchor** (control) | Frontline | Shields, hooks, corners the enemy | Bastion |
| **Berserker** (sustain brawler) | Frontline | Self-heals through aggression, AoE disruption | Ravok |
| **Mender** (pure healer) | Support | Direct heals, big defensive ult, weaken poke | Lumen |
| **Warden** (trap support) | Support | Rooting traps, plus a dash that roots what it runs through | Thorn |
| **Amplifier** (Firepower/Support hybrid) | Firepower-leaning | Buffs damage instead of healing it back | Cinder |
| **Bodyguard** (Frontline/Support hybrid) | Frontline-leaning | Mid pool, shares shields, peels with slows | Aegis |

## 4. Balance budgets (integer-only, per GAME_SPEC)

- **Damage per turn is bounded by the one-ability-per-turn rule** — a character's
  realistic output is one ability's worth. Target time-to-kill on a 100 HP target:
  **4–5 connected hits**; misses (the mind-game) stretch real TTK to 6+ turns.
- **Skill nuke ceiling: 34** (Vex's delayed grenade — pays for its power with a
  1-turn telegraph). Undelayed skill damage caps at 24.
- **Ultimate ceiling: 45 damage** (Vex) or an equivalent defensive/utility swing
  (Bastion's 50 shield + Might + Unstoppable for 2 turns).
- **Sustain ceiling: 25 heal per 2-turn cooldown** (Lumen). Shields cap at 30 per
  3-turn cooldown outside ults (Bastion).
- **Energy:** autos grant 8 on hit; utility 4–6; high-commit skills 8–10. With
  passive +5 and a ~60% hit rate, ultimates come online **turns 8–10** — one ult
  per character per match, as the climax, inside the 12-turn limit.
- **Displacement budget:** max one knockback ≥ 2 or pull ≥ 2 per kit (displacement
  cancels Move — the strongest soft-CC in the game).

## 5. The roster (9 characters)

| Character | Archetype | Theme | HP | One-line identity |
|---|---|---|---|---|
| Vex | Firepower | Sharpshooter | 95 | Punishes anyone standing still |
| Wisp | Firepower | Phantom | 85 | Ambush from stealth; loses when read |
| Kestrel | Firepower | Skirmisher | 90 | Never fights on the same square twice |
| Bastion | Frontline | Anchor | 130 | Corners you and trades up close |
| Ravok | Frontline | Berserker | 135 | Heals through the fight he starts |
| Lumen | Support | Mender | 105 | Outlasts; makes the enemy hit like a Support |
| Thorn | Support | Warden | 100 | The floor is the threat |
| Cinder | Firepower/Support | Amplifier | 95 | Damage now, more damage for everyone later |
| Aegis | Frontline/Support | Bodyguard | 120 | The kill you lined up isn't there anymore |

## 6. Kit sheets

Numbers below are the source-of-truth drafts in `data/characters/`. Format:
**Auto** / **S1–S3** (skills) / **Ult**.

### Vex — Sharpshooter Firepower (existing, unchanged)

Rail Shot (blast line 8, 26) / Frag Grenade (blast circle, 34, delay 1, cd 3) ·
Combat Roll (dash 3, cd 2) · **Overwatch Trap (prep, 20 + Reveal 2, cd 4, FREE)** /
Lance of Dawn (blast line 99, 45).

- **Wins by:** prediction at range; grenade zoning into rail lanes.
- **Loses to:** anything that closes the gap while Combat Roll is down (2-turn window).
- **Free action (2026-08-13):** the trap no longer costs Vex her shot. Cooldown 3→4 and
  energy 5→0 pay for it — see `free-actions-and-catalysts.md` §1.3.

### Wisp — Phantom Firepower (existing; archetype relabeled from `trickster`)

Dagger Flurry (blast cone 2, 22) / Blink (dash square 4, cd 2) · **Veil & Decoy
(prep, Stealth + decoy, cd 5, FREE)** · Bola (blast line 6, 12 + Slow, cd 2) /
Shadowstep Strike (dash, teleport 7 + 40 + Untargetable).

- **Wins by:** ambush and evasion; the opponent aiming at yesterday's square.
- **Loses to:** Reveal (Vex/Cinder), AoE fired at the obvious approach, being read.
- Decoy semantics were ruled in `rulings-v1-blockers.md` §R2 and shipped (backlog D1).
- **Free action (2026-08-13):** the kit's biggest change. Vanishing no longer costs the
  turn, so the real play is **Veil + Sprint 8** — reposition 8 squares while hidden, with
  a decoy left standing where you were. Free-Veil-plus-attack is self-defeating (attacking
  breaks Stealth), which is exactly why this is safe to give away. Cooldown 4→5, energy 6→0.

### Kestrel — Skirmisher Firepower (new)

- **Auto — Twin Bolts** (blast line 6, 24, e8).
- **S1 — Skim** (dash path 4, 12 to first enemy passed, cd 2, e5). The signature:
  the dodge *is* the poke. Dodges Blast aimed at origin and chips on the way out.
- **S2 — Slipstream** (prep self, Haste 1 + Energized 1, cd 3, e5). Converts a
  quiet turn into position and ult tempo.
- **S3 — Kite Shot** (blast line 7, 16 + Slow 1, cd 2, e8). Opens the gap Skim
  spends.
- **Ult — Tempest Run** (dash path 8, 35 + Slow 1 to enemies passed). A full-board
  damaging dash that also dodges the turn's Blast — the aggressive mirror of
  Wisp's ult, without the untargetability.
- **Wins by:** never being where the attack lands; 2-turn Skim clock managed well.
- **Loses to:** hard CC (Thorn root, Bastion hook) — grounded Kestrel is just a
  90 HP target. Deliberate: mobility is the whole defense budget, no shields.

### Bastion — Anchor Frontline (existing, unchanged)

Crushing Slam (blast cone 2, 24) / Bulwark (prep, 30 shield, cd 3) · Ram Charge
(dash 4, 15 + knockback 1, cd 3) · Chain Hook (blast line 5, 10 + pull 2, cd 3) /
Fortress Protocol (prep, 50 shield + Unstoppable + Might, 2 turns).

### Ravok — Berserker Frontline (new)

- **Auto — Cleave** (blast cone 2, 22, e8). Melee, ignores cover.
- **S1 — Bullrush** (dash path 4, 14 + knockback 2, cd 3, e8). The required
  Frontline damaging dash; knockback 2 is Ravok's whole displacement budget.
- **S2 — Blood Frenzy** (prep self, heal 20 + Might 1, cd 3, e6). Sustain through
  aggression: healing that also threatens 27 (22 × 1.25, floor) next Cleave.
- **S3 — Shockwave** (blast circle self r2, 12 + Slow 1, cd 2, e8). Point-blank
  AoE — disruption when surrounded, the 2v2 teamfight body-check.
- **Ult — Seismic Rupture** (blast circle self r3, 38 + Root 1). Stand in the
  middle of them and detonate. Root sets up next turn's Cleave on anyone who
  survives.
- **vs Bastion (intra-archetype check):** Bastion controls one target and turtles;
  Ravok trades HP for tempo and hits everyone adjacent. Bastion peels, Ravok dives.
- **Loses to:** kiting (Kestrel, Vex) while Bullrush is down; Weaken shuts off
  Blood Frenzy's math.

### Lumen — Mender Support (new)

- **Auto — Radiant Lash** (blast line 6, 18, e8).
- **S1 — Mending Light** (prep circle range 5 r1, heal 25, cd 2, e6). Aimed at
  own square in 1v1: 25 self-heal every other turn — the attrition engine.
- **S2 — Glimmer Step** (dash square 3, teleport + 15 shield 1 turn, cd 3, e5).
  The escape the 1v1 contract requires; prep-heal + dash-out is Lumen's core loop.
- **S3 — Dazzling Ray** (blast line 6, 12 + Weaken 1, cd 2, e8). Weaken turns an
  enemy Firepower's 26 into 19 — Lumen's real defensive stat.
- **Ult — Sanctuary** (prep circle range 5 r2, heal 40 + Might 1 to allies).
  Prep-phase, so it lands *before* the enemy's committed burst — the "you needed
  that kill" reversal. In 1v1 it's a 40 self-heal + Might swing turn.
- **1v1 math check:** vs Vex (26/turn best case): Lumen heals 25/2 turns + Weaken
  −6 on hit turns + cover play. Vex must out-predict for ~8 turns while eating
  18s. Close, slightly Vex-favored — correct for a healer, and it's the matchup
  to playtest first.

### Thorn — Warden Support (new)

- **Auto — Barbed Sling** (blast line 6, 17, e8).
- **S1 — Snare Bloom** (prep square range 4, trap: 12 + Root 1 on trigger, **cd 3,
  FREE**). Hidden, triggers on entry in any phase. A rooted victim loses their Move
  and stands in Barbed Sling range. **Free action (2026-08-13):** the single biggest
  improvement to Thorn — laying the garden no longer competes with her own auto
  attack. Cooldown 2→3 and energy 5→0 pay for it.
- **S2 — Bramble Stride** (dash path 3, 10 + Root 1 to the first unit crossed,
  cd 3, e5). *Replaced Lashing Vine 2026-08-13 (backlog Thorn-dash).* Thorn was
  the only kit in the roster with no Dash-phase ability — a gap the edge-cases
  ruling says to fix, not to exempt. The dash keeps the Warden identity by
  landing control rather than displacement: the escape still leaves someone stuck
  to the floor, in Barbed Sling range, exactly like a Snare Bloom does.
- **S3 — Verdant Veil** (prep circle range 5 r1, heal 20, cd 2, e6). Smaller than
  Lumen's — Thorn's defense budget is partly spent on control.
- **Ult — Overgrowth** (prep circle range 5 r2, heal 30 allies / Root 1 + Weaken 1
  enemies). The board itself takes a side for a turn.
- **Wins by:** owning ground. Every trap square is a square the opponent must
  respect; Bramble Stride adds a root you can *bring* to them.
- **What the swap cost:** the pull was the "drag them onto your own trap" combo —
  the flashiest thing Thorn did. Removing it was the right cut anyway: it was the
  only removable slot (the auto, the trap and the heal are all load-bearing — the
  heal is required by the Support 1v1 self-applicability rule), and it freed
  Thorn's displacement budget entirely, which now belongs to Bastion and Ravok
  alone (§4). **If playtest misses the combo**, the lever is giving Snare Bloom a
  second charge or widening its radius — not restoring the pull.
- **Loses to:** Unstoppable (Bastion ult walks through everything Thorn does),
  patient long-range play that never enters trap range.

### Cinder — Amplifier (Firepower/Support hybrid, Firepower-primary) (new)

- **Auto — Ember Bolt** (blast line 7, 22, e8).
- **S1 — Flare Burst** (blast circle range 6 r1, 18 + Reveal 1, cd 2, e8). AoE
  poke and the roster's stealth counter — checks Wisp and brush camping.
- **S2 — Stoke the Flame** (prep circle range 4 r1, Might 1 + Energized 1 to
  allies, cd 3, e6). The support half: no heals — Cinder makes damage, not HP.
  Self-cast in 1v1: 27 Ember Bolts and a faster ult clock.
- **S3 — Backdraft** (dash path 3, cd 3, e4). The Firepower survival tool, on a
  longer clock than Vex's roll (the buff turns pay for it).
- **Ult — Solar Flare** (blast circle range 6 r2, 35 + Weaken 1). Damage ult that
  also blunts the counter-swing.
- **Hybrid note (design rule this kit establishes):** a Firepower/Support spends
  its support budget on **force multiplication** (Might/Energized/Reveal), never
  on heals — so it never invalidates the Mender, and alone it simply buffs itself.
  Deals ~85% of a pure Firepower's damage in exchange.

### Aegis — Bodyguard (Frontline/Support hybrid, Frontline-primary) (new)

- **Auto — Shield Bash** (blast cone 2, 20, e8). Melee, ignores cover.
- **S1 — Barrier Pulse** (prep circle range 4 r1, 20 shield 1 turn, cd 2, e6).
  Aimable at self or an ally — the bread-and-butter peel.
- **S2 — Intercept** (dash square 4, teleport + 12 shield 1 turn, cd 3, e5).
  Arrives *before* Blast resolves: dash to the ally being dived, or out of the
  trap you're standing in.
- **S3 — Grounding Strike** (blast line 4, 14 + Slow 1, cd 2, e8). Peel: a slowed
  diver can't finish the walk to Aegis's Firepower.
- **Ult — Warding Halo** (prep circle self r2, 40 shield 2 turns to allies in
  area + Weaken 1 to enemies in area). Stand between your carry and their team.
  In 1v1: a 40/2-turn self-shield with a Weaken kicker if they're close.
- **Hybrid note (design rule this kit establishes):** a Frontline/Support gives up
  the displacement budget entirely (no knockback/pull — Bastion and Ravok own
  that) and ~15 HP off the Frontline band; in exchange its mitigation is
  **shareable**. Alone, every shield lands on itself and it plays as a slow,
  durable duelist.

## 7. Hybrid design notes (for future roster growth)

- **Primary archetype rules the stat line.** A hybrid uses its primary's HP band
  minus ~5–15 and its primary's auto-attack band minus ~2 damage. The secondary
  archetype shows up only in the 3 skill slots, never the auto or the HP pool.
- **Hybrids must not be strictly better solo than pure archetypes.** Enforced by
  the two rules above: Cinder < Vex at pure damage, Aegis < Bastion at pure
  frontlining. Their ceiling is only reachable with a teammate — which is what
  makes them 2v2 picks without being 1v1 traps (they're viable, not dominant).
- **Beneficial effects must be self-applicable** (same rule as Support) so hybrids
  hold their own 1v1.
- **Reserved future themes** (named now so they stay distinct): *Saboteur*
  (Trap Firepower — pure, deeper than Vex's single trap), *Vanguard*
  (Movement Frontline — dash-chaining), *Zephyr* (Movement Support — repositions
  allies; needs an ally-teleport `ENGINE ASK`), *Shade* (Stealth Support —
  stealth-shares; needs targeted-stealth semantics).

## 8. 2v2 pairing notes (forward-looking; 1v1 ships first)

- **Aegis + any Firepower** — the template comp: Intercept + Barrier Pulse turn a
  95 HP carry into a 130 HP problem.
- **Thorn + Bastion** — Move-phase denial: Bastion's hook drags a victim across
  Thorn's trap squares, and Bramble Stride roots whoever survives. Between
  displacement, roots and traps, nobody on the other team gets to walk.
  *(Updated 2026-08-13: Thorn's own pull became a dash — the displacement half of
  this pairing is now entirely Bastion's.)*
- **Cinder + Ravok** — Stoke the Flame's Might/Energized on a Berserker who's
  already healing through damage; fastest ult clocks in the game.
- **Lumen + Wisp** — Sanctuary insurance on an all-in assassin; Weaken covers the
  retreat when the ambush is read.
- **Anti-stack rule:** double-Support (Lumen + Thorn) is expected to be a stall
  comp; the 12-turn kill-leader limit is the systemic counter. Verify in playtest
  that turn-12 forces action rather than rewarding double-stall mirrors.
  **Re-scoped 2026-08-13:** this was sized against the old 1v1 numbers. The default
  format is now 2v2 at 4 kills / 16 turns (4v4: 5 / 20) — a longer clock, which is
  friendlier to stall than what I sized against. See `rulings-v1-blockers.md` §R6:
  the priority playtest is Lumen + Thorn versus double-Firepower at 2v2, and the
  lever if it fails is the per-format turn limit, not the Support kits.

## 9. ENGINE ASKs and proposed rulings — **ALL CLOSED 2026-08-13**

> **Status: this section is history.** Every item below was resolved in
> `docs/design/rulings-v1-blockers.md` §R7 — items 1 and 2 were **superseded** by what
> the 2026-08-15 teams build actually shipped (effect polarity; energy-on-use for
> beneficial abilities), items 3 and 4 are **confirmed** as shipped behavior, item 5 is
> unchanged, and item 6 (decoy) is **ruled** in §R2 of that file. One real gap surfaced
> in the reconciliation — `untargetable` was missing from the shipped polarity table and
> is now ruled **beneficial**. The text is kept as written for provenance; read §R7 for
> the current state. Kestrel's `tempest_run` also carries a `chargeHits: "all"` field
> proposed in §R1b and not yet implemented — the engine ignores it until then.

1. **`ENGINE ASK` — Effect target affinity.** When an ability's area contains both
   allies and enemies, effects apply by affinity: *beneficial* kinds (`heal,
   shield, might, haste, energized, stealth, unstoppable, untargetable, teleport`)
   apply to the caster/allies only; *harmful* kinds (`damage, weaken, slow, root,
   reveal, knockback, pull, trap`) to enemies only. Needed by Lumen, Thorn,
   Cinder, Aegis (any aimed circle), and it's what makes Overgrowth/Warding
   Halo's split effects one ability instead of two. Until 2v2, "allies" = caster.
2. **`ENGINE ASK` — Energy on ally-benefit.** `types.ts` grants `energyGain` "on
   use (self-target) or on hitting ≥1 enemy". Extend: an ability whose effects are
   all-beneficial grants energy when it affects ≥ 1 friendly unit (incl. caster).
   Otherwise Support kits are energy-starved and never reach their ults.
3. **Ruling (pattern already in data) — Trap rider effects.** A `trap` effect's
   sibling effects in the same `effects[]` apply to the *triggering* unit at
   trigger time (Vex: trap + Reveal; Thorn: trap + Root). Confirming the existing
   Vex reading rather than asking for something new.
4. **Ruling — Dash rider effects apply to the caster** at the destination (Wisp's
   ult precedent; used by Lumen's Glimmer Step and Aegis's Intercept shields).
5. **No life steal in v1** — intentionally absent from kits and from
   `EFFECT_KINDS`. Firepower survivability is dashes/stealth/shields; Berserker
   sustain is a self-heal skill. Revisit only if a future theme demands it.
6. **Decoy remains OPEN** (edge-cases.md) — nothing in this roster adds pressure
   to resolve it beyond Wisp, who already shipped with it.

## 10. Playtest priorities

1. Lumen vs Vex (does a Mender actually survive a Sharpshooter 1v1?).
2. Wisp vs Cinder (is Reveal on a 2-turn cooldown too hard a counter?).
3. Thorn vs Bastion (Unstoppable ult vs a control kit — is turtling until 100
   energy degenerate?).
4. Kestrel mirror (movement-vs-movement: does anyone ever die?).
5. Turn-12 behavior of double-sustain matchups (Lumen/Thorn/Ravok mirrors).
