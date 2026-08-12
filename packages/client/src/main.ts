/**
 * M2 client entry (item 17): render a live engine `GameState` — terrain, units,
 * and HP / shield / energy bars — driven entirely by `@cards/engine`. No game
 * logic here; the render layer is a pure consumer of engine state and, next, the
 * `TurnEvent` log (items 18–20). Shown here as a 2v2 to exercise team-coloured,
 * N-unit rendering (GAME_SPEC §1), but `renderState` reads any format.
 */
import { buildRoster, createMatch, validateMap, validateMapForFormat, type CharacterDef, type MapDef } from '@cards/engine';
import { cssVar, mountState } from './render.js';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';

const map = duelArena as unknown as MapDef;
const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;

const errors = [...validateMap(map), ...validateMapForFormat(map, '2v2')];
if (errors.length > 0) {
  document.getElementById('app')!.innerHTML = `<pre style="color:#ff6b5e">Setup failed:\n${errors.join('\n')}</pre>`;
  throw new Error('invalid setup');
}

// A demo 2v2 opening position, straight from the engine's match builder.
buildRoster([VEX, BASTION, WISP]);
const state = createMatch(map, '2v2', [[VEX, WISP], [BASTION, VEX]]);
mountState(document.getElementById('board')!, map, state);

// Legend
const legend = document.getElementById('legend')!;
const entries: Array<[string, string]> = [
  ['--wall', 'Wall'],
  ['--cover', 'Cover'],
  ['--brush', 'Brush'],
  ['--team0', 'Team 1'],
  ['--team1', 'Team 2'],
  ['--hp', 'HP'],
  ['--shield', 'Shield'],
  ['--energy', 'Energy'],
];
for (const [varName, label] of entries) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.innerHTML = `<span class="swatch" style="background:${cssVar(varName)}"></span>${label}`;
  legend.appendChild(chip);
}
