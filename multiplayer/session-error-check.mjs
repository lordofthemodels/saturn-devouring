import assert from 'node:assert/strict';
import {
  PeerConnectionError,
  RelayCredentialsError,
  fetchRelayIceServers,
  peerConnectionFailure,
} from './session.js';

for (const event of ['room_dial_failed', 'room_accept_failed']) {
  const error = peerConnectionFailure(event);
  assert(error instanceof PeerConnectionError);
  assert.equal(error.code, 'PEER_CONNECTION_FAILED');
  assert.match(error.message, /WebRTC data channel timed out/);
  assert.match(error.message, /relay credentials were unavailable/);
}
const relayedFailure = peerConnectionFailure('room_dial_failed', { relayAvailable: true });
assert.match(relayedFailure.message, /even with relay fallback/);
assert.equal(peerConnectionFailure('peer_path'), null);
assert.equal(peerConnectionFailure('rendezvous_lost'), null);

const iceServers = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: [
      'turn:turn.cloudflare.com:53?transport=udp',
      'turns:turn.cloudflare.com:443?transport=tcp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ],
    username: 'user',
    credential: 'secret',
  },
];
const fetched = await fetchRelayIceServers({
  fetcher: async (url, options) => {
    assert.equal(url, '/api/turn-credentials');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    return Response.json({ iceServers });
  },
});
assert.deepEqual(fetched, [{
  ...iceServers[1],
  urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
}]);
assert(fetched.every((server) => {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.every((url) => url.startsWith('turn'));
}));
await assert.rejects(
  fetchRelayIceServers({ fetcher: async () => Response.json({ iceServers: [] }) }),
  (error) => error instanceof RelayCredentialsError && error.code === 'TURN_UNAVAILABLE',
);

console.log('multiplayer connection errors ✓');
