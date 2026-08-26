import assert from 'node:assert/strict';
import {
  PeerConnectionError,
  RelayCredentialsError,
  fetchRelayIceServers,
  peerConnectionFailure,
  summarizeIceDiagnostics,
} from './session.js';

for (const event of ['room_dial_failed', 'room_accept_failed']) {
  const error = peerConnectionFailure(event);
  assert(error instanceof PeerConnectionError);
  assert.equal(error.code, 'PEER_CONNECTION_FAILED');
  assert.match(error.message, /WebRTC data channel timed out/);
  assert.match(error.message, /relay credentials were unavailable/);
}
const blockedRelay = peerConnectionFailure('room_dial_failed', {
  relayAvailable: true,
  diagnostic: { relayCandidates: 0 },
});
assert.equal(blockedRelay.code, 'TURN_PATH_UNAVAILABLE');
assert.match(blockedRelay.message, /could not allocate a TURN relay route/);
const relayedFailure = peerConnectionFailure('room_dial_failed', {
  relayAvailable: true,
  diagnostic: { relayCandidates: 1 },
});
assert.match(relayedFailure.message, /relay route was available/);
assert.equal(peerConnectionFailure('peer_path'), null);
assert.equal(peerConnectionFailure('rendezvous_lost'), null);

assert.deepEqual(summarizeIceDiagnostics([
  { candidateTypes: ['host', 'srflx'], errorCodes: [701] },
  { candidateTypes: ['host', 'relay'], errorCodes: [701, 401] },
]), {
  connections: 2,
  relayCandidates: 1,
  candidateTypes: ['host', 'relay', 'srflx'],
  errorCodes: [401, 701],
});

const iceServers = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'user', credential: 'secret' },
];
const fetched = await fetchRelayIceServers({
  fetcher: async (url, options) => {
    assert.equal(url, '/api/turn-credentials');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    return Response.json({ iceServers });
  },
});
assert.deepEqual(fetched, iceServers);
await assert.rejects(
  fetchRelayIceServers({ fetcher: async () => Response.json({ iceServers: [] }) }),
  (error) => error instanceof RelayCredentialsError && error.code === 'TURN_UNAVAILABLE',
);

console.log('multiplayer connection errors ✓');
