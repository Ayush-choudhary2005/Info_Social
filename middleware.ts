import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const start = Date.now();
  const response = NextResponse.next();
  const latencyMs = Date.now() - start;

  const collectorUrl = (
    process.env.SECURITY_SDK_COLLECTOR_URL ||
    'https://api-security-analytics-dashboard-vyfe.onrender.com'
  ).replace(/\/$/, '') + '/ingest';

  const apiKey =
    process.env.SECURITY_SDK_API_KEY ||
    'ask_7a927e36f15f_335f53cf6bb778c9a97b2e23e24e8e15';

  // Client IP resolution (Vercel provides accurate client IPs via headers)
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  // Fire-and-forget telemetry promise
  const telemetryPromise = fetch(collectorUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    // Inside your middleware.ts
    body: JSON.stringify({
      endpoint: request.nextUrl.pathname,
      method: request.method,
      status_code: response.status,
      latency_ms: latencyMs,
      ip: clientIp,
      user_agent: request.headers.get('user-agent') || '',
      metadata: {
        host: request.headers.get('host') || '',
        latitude: request.headers.get('x-vercel-ip-latitude'),
        longitude: request.headers.get('x-vercel-ip-longitude'),
        city: request.headers.get('x-vercel-ip-city'),
        country: request.headers.get('x-vercel-ip-country'),
        region: request.headers.get('x-vercel-ip-country-region'),
      },
    }),
  }).catch(() => {});

  // event.waitUntil ensures the telemetry dispatch completes on Vercel Edge
  // without delaying or blocking the user's response
  if (event?.waitUntil) {
    event.waitUntil(telemetryPromise);
  }

  return response;
}

// Only monitor pages and API routes; skip static assets
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};