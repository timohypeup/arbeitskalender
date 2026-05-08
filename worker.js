// Cloudflare Worker — CORS-Proxy fuer Kalender-Feeds + Asana API Proxy
// Deploy: wrangler deploy
// Asana PAT setzen: wrangler secret put ASANA_PAT

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // --- Asana API Proxy: /asana/... ---
    if (url.pathname.startsWith('/asana/')) {
      return handleAsana(url, request, env);
    }

    // --- Kalender CORS Proxy: /?url=... ---
    return handleCalendar(url);
  }
};

async function handleAsana(url, request, env) {
  const pat = env.ASANA_PAT;
  if (!pat) {
    return jsonResponse({ error: 'ASANA_PAT secret not configured' }, 500);
  }

  // /asana/... -> https://app.asana.com/api/1.0/...
  const asanaPath = url.pathname.replace(/^\/asana/, '');
  const asanaUrl = `https://app.asana.com/api/1.0${asanaPath}${url.search}`;

  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

  try {
    const fetchOptions = {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json',
        ...(isWrite ? { 'Content-Type': 'application/json' } : {})
      }
    };

    // Body fuer schreibende Requests weiterleiten
    if (isWrite) {
      fetchOptions.body = await request.text();
    }

    const resp = await fetch(asanaUrl, fetchOptions);
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
        // Kein Cache fuer schreibende Requests
        'Cache-Control': isWrite ? 'no-store' : 'public, max-age=120'
      }
    });
  } catch (err) {
    return jsonResponse({ error: 'Asana fetch failed: ' + err.message }, 502);
  }
}

async function handleCalendar(url) {
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  const allowed = [
    'caldav.icloud.com',
    'calendar.google.com',
    'outlook.office365.com',
    'outlook.live.com'
  ];

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  if (!allowed.some(domain => targetUrl.hostname.endsWith(domain))) {
    return new Response('Domain not allowed', { status: 403 });
  }

  try {
    const resp = await fetch(target, {
      headers: {
        'User-Agent': 'macOS/15.0 CalendarAgent/1.0',
        'Accept': 'text/calendar, text/plain, */*'
      }
    });

    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (err) {
    return new Response('Fetch failed: ' + err.message, { status: 502 });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
