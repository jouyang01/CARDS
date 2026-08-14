/**
 * M2 client entry: launch a local hot-seat 2v2 duel driven entirely by
 * `@cards/engine`. Order entry (item 18), turn resolution + event-log playback
 * (item 19), and per-player→per-team seating (item 20) all live in the tested
 * pure modules; this file just picks the match setup and mounts the controller.
 */
import { buildRoster, validateMap, validateMapForFormat, type CharacterDef, type MapDef } from '@cards/engine';
import { startHotSeat, type HotSeatUI } from './app.js';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

const map = duelArena as unknown as MapDef;
const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;

const errors = [...validateMap(map), ...validateMapForFormat(map, '2v2')];
if (errors.length > 0) {
  document.getElementById('app')!.innerHTML = `<pre style="color:#ff6b5e">Setup failed:\n${errors.join('\n')}</pre>`;
  throw new Error('invalid setup');
}

const ui: HotSeatUI = {
  board: document.getElementById('board')!,
  status: document.getElementById('status')!,
  controls: document.getElementById('controls')!,
  log: document.getElementById('log') ?? undefined,
};

// A demo 2v2: Team 1 = Vex + Wisp, Team 2 = Bastion + Aegis. Team 1 is split
// across two players (one character each); Team 2 is one player running both —
// the asymmetric 3-player hot-seat.
startHotSeat(ui, map, buildRoster([VEX, BASTION, WISP, AEGIS]), [[VEX, WISP], [BASTION, AEGIS]], '2v2', [2, 1]);
