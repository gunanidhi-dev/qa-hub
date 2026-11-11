import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceIpAllowlist, isAllowedIp } from '../scripts/ip-access.js';

test('allows only the two specified IPs, including IPv4-mapped connections', () => {
  for (const ip of ['100.31.136.152', '120.56.46.9', '::ffff:100.31.136.152', '::FFFF:120.56.46.9']) {
    assert.equal(isAllowedIp(ip), true, ip);
  }
  for (const ip of [undefined, '', '127.0.0.1', '::1', '100.31.136.153', '120.56.46.90', '192.168.1.1']) {
    assert.equal(isAllowedIp(ip), false, String(ip));
  }
});

test('denies requests even when forwarding headers claim an allowed IP', () => {
  let status, headers, body;
  const res = {
    writeHead(code, values) { status = code; headers = values; },
    end(value) { body = value; },
  };
  assert.equal(enforceIpAllowlist({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '100.31.136.152', 'x-real-ip': '120.56.46.9' },
  }, res), false);
  assert.equal(status, 403);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(body, /Forbidden/);
});

test('allowed connections continue without sending a response', () => {
  assert.equal(enforceIpAllowlist({ socket: { remoteAddress: '120.56.46.9' } }, {
    writeHead() { assert.fail('must not send a response'); },
    end() { assert.fail('must not end an allowed request'); },
  }), true);
});
