/**
 * Cards room server — Cloudflare Worker + Durable Object (M3 milestone).
 *
 * PLACEHOLDER. The real implementation (see docs/ARCHITECTURE.md):
 *  - POST /rooms            → mint a 4-letter room code, create a Durable Object
 *  - GET  /rooms/:code/ws   → WebSocket upgrade into the room DO
 *  - The DO holds authoritative GameState + full order history, reveals no
 *    orders until both players lock in (or timer), runs resolveTurn() from
 *    @cards/engine as the authority, and supports reconnect-by-code with
 *    replay.
 *
 * Backlog item 17. Requires `wrangler` (added as a dependency at M3) and a free
 * Cloudflare account.
 */
export default {
  async fetch(_request: unknown): Promise<Response> {
    return new Response('Cards room server — arrives in milestone M3. See docs/BACKLOG.md.', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  },
};
