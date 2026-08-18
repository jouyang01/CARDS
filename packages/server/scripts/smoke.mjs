/**
 * M3-DEPLOY-PREP — boot the Worker on the real runtime and poke it.
 *
 * Every other server test drives `RoomHub` directly, which is the right trade:
 * the rules are pure, and booting a Workers runtime to assert seat bounds would
 * be testing Cloudflare. But that leaves one thing completely unchecked — that
 * this code **is a Worker at all**. A missing binding, a Durable Object without
 * its migration, an import the bare runtime cannot resolve: none of those can
 * fail a unit test, and all of them fail a deploy.
 *
 * So this is deliberately shallow and deliberately real. It starts
 * `wrangler dev` (workerd, the same runtime `wrangler deploy` publishes to),
 * mints a room, reads it back, and stops. If that works, the Worker boots, the
 * DO binding resolves, the SQLite migration is accepted and the routes are
 * wired — which is the whole question this answers.
 *
 * Not part of `npm test`: it downloads and boots a runtime, which a unit suite
 * should not do on every save. `npm run smoke` in the server workspace, and the
 * gate a human runs before a deploy.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

/** The server workspace, and wrangler's own entry point in the monorepo root. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const PORT = Number(process.env.SMOKE_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}`;
/** Generous: the first run compiles the Worker and may fetch the runtime. */
const BOOT_TIMEOUT_MS = 90_000;

const log = (...parts) => { process.stdout.write(`${parts.join(' ')}\n`); };

/** Poll until the Worker answers anything at all, or give up. */
async function waitForBoot(child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early (code ${child.exitCode})`);
    try {
      // Any answer proves the runtime is up; a 404 from an unrouted path is a
      // perfectly good "yes". Only a connection refusal means "not yet".
      await fetch(`${BASE}/`, { method: 'GET' });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`the Worker did not answer within ${BOOT_TIMEOUT_MS}ms`);
}

/** One check. Throws with the reason, so the caller can print and exit. */
async function expect(label, run) {
  const detail = await run();
  log(`  ✓ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/**
 * `detached` puts wrangler in its **own process group**, and the teardown kills
 * the group rather than the process.
 *
 * Not incidental: `wrangler dev` is a supervisor that runs `workerd` beneath it,
 * so signalling only the process we spawned leaves the runtime holding the port.
 * That is exactly what happened the first time this ran — the checks passed, the
 * script exited, and a stray Worker kept listening.
 */
const child = spawn(
  process.execPath,
  [WRANGLER, 'dev', '--port', String(PORT), '--local', '--log-level', 'warn'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  },
);

/** Take the whole group down, and do not care if it is already gone. */
function stop() {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}
// A Ctrl-C or a CI cancellation must not leak a runtime either.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(130); });

let failure;
try {
  log(`booting the Worker on ${BASE}…`);
  await waitForBoot(child);

  let code;
  await expect('POST /rooms mints a room', async () => {
    const response = await fetch(`${BASE}/rooms?format=2v2`, { method: 'POST' });
    if (!response.ok) throw new Error(`POST /rooms answered ${response.status}`);
    const body = await response.json();
    if (typeof body.code !== 'string') throw new Error(`no room code in ${JSON.stringify(body)}`);
    code = body.code;
    return code;
  });

  await expect('the Durable Object holds it', async () => {
    // The real proof in this file: the room came back, so a DO was created,
    // its SQLite migration was accepted and its storage answered.
    const response = await fetch(`${BASE}/rooms/${code}`);
    if (!response.ok) throw new Error(`GET /rooms/${code} answered ${response.status}`);
    const room = await response.json();
    if (room.code !== code) throw new Error(`the DO returned room ${room.code}`);
    return `${room.format}, ${room.seats.length} seats`;
  });

  await expect('an unknown code is a 404, not a new room', async () => {
    const response = await fetch(`${BASE}/rooms/ZZZZ`);
    if (response.status !== 404) throw new Error(`answered ${response.status}`);
    return '404';
  });

  await expect('the removed start route is still gone', async () => {
    // Confirmed here rather than trusted: an unauthenticated route that could
    // start somebody else's match is the one thing worth re-checking against
    // the real router before a deploy (PR #68 deleted it).
    const response = await fetch(`${BASE}/rooms/${code}/start`, { method: 'POST' });
    if (response.status < 400) throw new Error(`POST /rooms/:code/start answered ${response.status}`);
    return String(response.status);
  });

  log('\nsmoke check passed — the Worker boots and its rooms are real.');
} catch (error) {
  failure = error;
} finally {
  stop();
}

if (failure !== undefined) {
  process.stderr.write(`\nsmoke check FAILED: ${failure.message}\n`);
  process.exit(1);
}
