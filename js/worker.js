/* ANTRA-WEB agent proxy — Cloudflare Worker
   -------------------------------------------------------------
   Purpose: pure server-to-server passthrough between the portfolio
   (https://antra-web.github.io) and the two REAL n8n Chat Trigger
   webhooks. It never generates, mocks, or scripts a reply — it only
   forwards the exact request body it receives and returns the exact
   response body n8n sends back.

   Why this exists: n8n Chat Trigger webhooks require an explicit
   "Allowed Origins (CORS)" value to accept cross-origin browser
   fetch() calls. This Worker removes that dependency entirely —
   the Worker-to-n8n call is server-to-server (no browser, no CORS
   involved), and the Worker itself sends back permissive-but-scoped
   CORS headers to your GitHub Pages origin only.

   Routes:
     POST https://<your-worker>.workers.dev/ava   -> Ava's real webhook
     POST https://<your-worker>.workers.dev/flow  -> Flow's real webhook
*/

const TARGETS = {
  '/ava': 'https://antra.app.n8n.cloud/webhook/d9217086-87a2-44ed-bf36-dacbf4b5cacf/chat',
  '/flow': 'https://lovely-webdev.app.n8n.cloud/webhook/000a0ca5-e54a-4d26-944e-fc2189711aee/chat',
};

// Locked to your real production origin. Add more entries here only
// if you actually serve the site from another origin (e.g. a custom
// domain later).
const ALLOWED_ORIGINS = [
  'https://antra-web.github.io',
];

function pickOrigin(requestOrigin) {
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
}

function corsHeaders(requestOrigin) {
  return {
    'Access-Control-Allow-Origin': pickOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const target = TARGETS[url.pathname];
    if (!target) {
      return new Response(
        JSON.stringify({ error: 'Unknown route. Use /ava or /flow.' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    let bodyText;
    try {
      bodyText = await request.text();
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Could not read request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // Forward the REAL request to the REAL n8n webhook. Server-to-server,
    // so no browser CORS is involved on this leg.
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText,
      });
    } catch (err) {
      // n8n itself was unreachable from Cloudflare's network — this is a
      // real infrastructure failure, not something to paper over.
      return new Response(
        JSON.stringify({ error: 'Upstream n8n webhook unreachable', detail: String(err) }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    const respText = await upstream.text();

    // Return the REAL upstream status and body untouched.
    return new Response(respText, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        ...cors,
      },
    });
  },
};
