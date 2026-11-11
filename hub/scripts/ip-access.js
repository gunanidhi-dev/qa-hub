// Trust the TCP connection address, never client-supplied forwarding headers.
const ALLOWED_IPS = new Set(['100.31.136.152', '120.56.46.9']);

export function isAllowedIp(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return ALLOWED_IPS.has(normalized);
}

export function enforceIpAllowlist(req, res, { allowLoopback = false } = {}) {
  const address = req.socket.remoteAddress?.toLowerCase().replace(/^::ffff:/, '');
  if (allowLoopback && (address === '127.0.0.1' || address === '::1')) return true;
  if (isAllowedIp(req.socket.remoteAddress)) return true;
  res.writeHead(403, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end('Forbidden: access from your IP address is not allowed.');
  return false;
}
