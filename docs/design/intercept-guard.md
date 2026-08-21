# intercept-guard.md — `INTERCEPT-GUARD`: Aegis's thesis ability (Designer)

**Date:** 2026-08-17 · **Status:** RULED (owner directive). Engine + data + client; the whole
rebuild ships in one Builder commit — nothing here is expressible in data alone, so no data
changes ride ahead of the engine.

## 1. The redesign, and why it is the right one

Today's Intercept is a teleport-to-square plus a self-shield — a generic escape wearing a
bodyguard's name. The owner's rebuild, verbatim in substance:

> **Intercept (dash, cd 5, e5):** teleport adjacent to an **ally within range 5**. For the
> rest of that turn, **damage that ally would take is dealt to Aegis instead.** Aegis — and
> only Aegis — gains a shield sized to cover *most but not all* of one regular attack.

The owner's argument is the design: **Dash resolves before Blast. He arrives, and then the
damage lands on him.** The phase order the whole game runs on is what makes bodyguarding
mechanically real rather than flavour — the enemy aimed at the ally during Decision, Aegis
interposes in Dash, and their locked Blast finds him standing there. It converts the game's
core mind-game (aim at where they will be) into Aegis's kit: the enemy must now predict not
one position but *whether the Bodyguard commits*.

This also completes the Bodyguard hybrid's identity ruling ("no displacement budget; its
mitigation is shareable"): a redirect is the most shareable mitigation there is.

## 2. The numbers

| Field | Value | Why |
|---|---|---|
| Phase / shape | `dash`, ally-targeted (see §3) | The thesis — arrive before the damage |
| Range | **5** | Owner's number; one more than the dash floor, so the peel reaches a flanked carry |
| Cooldown | **5** (unchanged) | The rebalance set it; the owner did not move it |
| Energy | 5 (unchanged) | Utility band |
| Self-shield | **18, duration 1, Aegis only** | The shipped non-support basic band is **20–26** (Bastion 24, Ravok 22, Wisp 22, Kestrel 24, Vex 26). 18 covers 90% of a 20 and 69% of a 26 — *most but not all* of any regular attack, exactly as directed. The old ally-shield `impact` block is **removed**: the guard is the ally's protection now |

Aegis at 155 HP eating one mostly-shielded basic every 5 turns is sustainable by design;
the cost is that eating a *skill* or a focused turn is real damage, which is the read the
enemy gets to make.

## 3. Targeting — ally-bound, with the chase precedent

- The player aims Intercept **at an ally** (BODY-CLICK already makes clicking a unit mean
  the unit). The order binds the **ally's unit id** — the same pattern `chaseTargetId`
  shipped for enemies, on the ally side. A square-aim that merely lands near an ally is not
  the contract; the guard needs an unambiguous target at 4v4.
- **Landing square:** the nearest open square **orthogonally adjacent** (Manhattan-1, the
  perception-adjacency convention) to the guarded ally's position **at the start of the
  Dash phase**, ties broken by the engine's fixed direction order — deterministic, no
  choice UI needed. If all four are blocked, **Intercept fizzles harmlessly** (teleport
  precedent: fizzle, cooldown spent).
- A guarded ally who dashes away this turn **stays guarded** — the guard binds to the unit,
  not to adjacency. Simple, and the fizzle-vs-track question never arises.
- **1v1 fallback (the Support/hybrid self-applicability rule is standing):** with no living
  ally, Intercept may target a **square** within 5 — teleport + the 18 shield, no guard.
  Alone, it degrades to exactly the escape it used to be, so the kit stays 1v1-viable.

## 4. The `guard` effect — ENGINE ASK, and the rulings that bound it

New `EFFECT_KIND` **`guard`** `{ duration: 1 }` — the first new kind since DOT-HOT, and
justified the same way: no composition of existing kinds can express "your damage goes to
him." Beneficial polarity (own team only). Status carries the caster's unit id (the
attribution plumbing DOT-HOT already added to `StatusInstance`).

Semantics, each a ruling the Builder must not have to invent:

1. **What redirects: damage only.** Statuses, displacement (knockback/pull), and Move-loss
   land on the ally as normal. A bodyguard takes the bullet, not the leash.
2. **Which damage: enemy-dealt, while the guard is live.** Direct hits in Blast, enemy trap
   damage the ally triggers in Dash or Move — all redirect. **Not** redirected: the ally's
   own `selfHarm`/`selfDamagePct` damage (guarding someone against their own recklessness
   is neither the fantasy nor good for the Ravok+Aegis degenerate case) and **end-of-turn
   DoT ticks** (the DoT was applied to the ally before or despite the guard; ticks are not
   hits).
3. **The amount: what would have reached the ally's shields/HP.** Attacker's Might/Weaken
   and the **ally's cover** compose exactly as if the hit landed on the ally — the shot was
   fired at the ally's square — and the resulting number is then applied to **Aegis's
   shields, then Aegis's HP**. Aegis's own cover is not recomputed (he is not where the
   shot was aimed); his shield is the mitigation he brought.
4. **Duration: the rest of the turn it is cast.** Applied in Dash with `duration 1`, it
   covers Blast and Move and expires at end-of-turn tick. No multi-turn guard in v1.
5. **If Aegis dies mid-turn, the guard dies with him** — damage after his death lands on
   the ally normally (mid-phase-death rule, unchanged). If redirected damage kills Aegis,
   the **attacker's team gets the kill** (standard attribution; no new rule needed).
6. **Stacking: refresh-not-stack like every status; one guard per ally.** Two Aegis (mirror
   4v4) guarding the same ally: second application replaces the first — refresh semantics,
   latest caster wins, deterministic by resolution order.
7. **Simultaneity:** redirection changes *where* damage applies, not *when*. Blast still
   gathers-then-applies; mutual kills still land in full; PHASE-STATUS-FIRST is untouched
   (guard is applied in Dash, strictly before any Blast sub-step).

## 5. Client

- **Aim:** click an ally in range; the preview shows the landing square and a guard link
  (ally highlighted, line to Aegis's landing). AIM-PREVIEW-TRUE applies trivially — the
  aimable set is "allies within 5," drawn as such.
- **Status row:** guard icon (shield-with-figure), blue, on the **ally**; duration numeral
  as usual. Aegis needs no mirrored icon — his tell is standing next to them.
- **Events:** `guardApplied { casterId, allyId }` and, per redirected hit,
  `damageRedirected { from allyId, to casterId, amount }` — playback must *show* the shot
  bending to Aegis or the mechanic reads as a miss bug. The combat log prints it.

## 6. Tests the Builder owes (golden rule #3)

1. **The thesis test:** enemy locks Blast at the ally's square; Aegis Intercepts in Dash;
   the damage lands on Aegis (shield first), the ally takes zero.
2. Ally's cover still reduces the redirected amount; Aegis's own cover does not.
3. Knockback aimed at the ally still displaces the **ally** (damage redirected, push not).
4. Enemy trap the ally steps on in Move redirects; end-of-turn DoT tick on the ally does
   not; the ally's own `selfDamagePct` recoil does not.
5. Aegis killed in Blast by the first redirected hit → the second hit lands on the ally.
6. Landing determinism: occupied/blocked adjacents → fixed-order pick; all four blocked →
   fizzle, cooldown spent.
7. 1v1: no living ally → square-target fallback works; ally alive → square-targeting an
   empty square is **invalid** (the fallback is a fallback, not a choice).
8. Mirror 4v4: second guard on the same ally replaces the first.

## 7. Roster bookkeeping

The Bodyguard theme line updates from "shares shields" to **"takes the hit himself"**;
Intercept leaves the `impact` list (Shadowstep remains its only roster user, plus Bullrush).
The TTK-SKILL-DAMAGE tier rule is unaffected — Intercept deals no damage, so it is simply
not measured. Playtest flags: (a) guard + Bulwark-style enemy focus may make the
Aegis-guarded carry unkillable at 2v2 — the lever is the shield 18 → 14, never the redirect
itself; (b) if Intercept-fizzle-when-surrounded feels bad, allow diagonal landing squares
as the second ring — a ruling away, not a redesign.
