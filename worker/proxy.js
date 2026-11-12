// Optional Cloudflare Worker for Mindline demos.
// Keeps the Anthropic API key off the page: the page sends a shared passcode instead.
//
// Secrets (wrangler secret put …): ANTHROPIC_API_KEY, DEMO_PASSCODE
// Vars (wrangler.toml): ALLOWED_ORIGIN (comma-separated), ALLOWED_MODELS (comma-separated)
export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'access-control-allow-origin': okOrigin ? origin : 'null',
      'access-control-allow-headers': 'content-type, x-demo-passcode',
      'access-control-allow-methods': 'POST, OPTIONS',
      'vary': 'origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });

    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') return error(404, 'Not found', cors);
    if (!okOrigin) return error(403, 'This page address is not allowed to use the proxy.', cors);
    if (!env.DEMO_PASSCODE || req.headers.get('x-demo-passcode') !== env.DEMO_PASSCODE) return error(403, 'Wrong passcode.', cors);

    let body;
    try { body = await req.json(); } catch { return error(400, 'Request body is not JSON.', cors); }
    const models = (env.ALLOWED_MODELS || 'claude-sonnet-5-5,claude-haiku-5-5').split(',').map(s => s.trim());
    if (!models.includes(body.model)) return error(400, `Model not allowed. Use one of: ${models.join(', ')}.`, cors);
    body.max_tokens = Math.min(Number(body.max_tokens) || 600, 1000);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    const headers = new Headers(cors);
    headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
    headers.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function error(status, message, cors) {
  return new Response(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }), {
    status, headers: { ...cors, 'content-type': 'application/json' },
  });
}
