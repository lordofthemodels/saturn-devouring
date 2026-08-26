import assert from 'node:assert/strict';
import worker, { turnCredentials } from './worker.js';

const origin = 'https://charon.example';
const request = () => new Request(`${origin}/api/turn-credentials`, {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: '{}',
});
const iceServers = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'short-lived-user', credential: 'short-lived-secret' },
];
let upstreamRequest;
const response = await turnCredentials(request(), {
  TURN_KEY_ID: 'turn-key-id',
  TURN_KEY_TOKEN: 'turn-key-token',
}, {
  createIdentifier: () => 'test-client',
  fetcher: async (url, options) => {
    upstreamRequest = { url, options };
    return Response.json({ iceServers }, { status: 201 });
  },
});
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(await response.json(), { iceServers });
assert.match(upstreamRequest.url, /turn-key-id\/credentials\/generate-ice-servers$/);
assert.equal(upstreamRequest.options.headers.authorization, 'Bearer turn-key-token');
assert.deepEqual(JSON.parse(upstreamRequest.options.body), { ttl: 21_600, customIdentifier: 'charon-test-client' });

const denied = await turnCredentials(new Request(`${origin}/api/turn-credentials`, {
  method: 'POST',
  headers: { origin: 'https://attacker.example' },
}), { TURN_KEY_ID: 'id', TURN_KEY_TOKEN: 'token' });
assert.equal(denied.status, 403);
assert.equal((await denied.json()).error.code, 'ORIGIN_DENIED');

const unavailable = await turnCredentials(request(), {
  TURN_KEY_ID: 'id',
  TURN_KEY_TOKEN: 'token',
}, { fetcher: async () => new Response('', { status: 502 }) });
assert.equal(unavailable.status, 503);
assert.equal((await unavailable.json()).error.code, 'TURN_UNAVAILABLE');

const asset = new Response('asset');
const served = await worker.fetch(new Request(`${origin}/game/`), { ASSETS: { fetch: async () => asset } });
assert.equal(served, asset);

console.log('TURN credential worker ✓');
