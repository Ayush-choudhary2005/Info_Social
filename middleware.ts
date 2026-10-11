// middleware.ts (Root of your Next.js News App)
import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

const COLLECTOR_URL = 'https://api-security-analytics-dashboard-vyfe.onrender.com';
const API_KEY = 'ask_7a927e36f15f_335f53cf6bb778c9a97b2e23e24e8e15'; // From your dashboard

// In-memory cache of blocked IPs synced from dashboard
let blockedIpsCache: Set<string> = new Set();
let lastSyncTime = 0;
const SYNC_INTERVAL_MS = 30000; // Check for updated blocked IPs every 30s

async function syncBlockedIps() {
  const now = Date.now();
  if (now - lastSyncTime < SYNC_INTERVAL_MS) return;
  lastSyncTime = now;
  try {
    const res = await fetch(`${COLLECTOR_URL}/api/v1/blocked-ips`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.blocked_ips)) {
        blockedIpsCache = new Set(data.blocked_ips);
      }
    }
  } catch {
    // Fail-open: network glitch never breaks your news website
  }
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  // 1. Background sync without slowing down the page request
  if (event?.waitUntil) {
    event.waitUntil(syncBlockedIps());
  } else {
    syncBlockedIps().catch(() => {});
  }

  // 2. Active Enforcement: Return 403 immediately if client IP is blocked
  if (blockedIpsCache.has(clientIp)) {
    return new NextResponse(
      JSON.stringify({
        error: 'Forbidden',
        message: 'Your IP has been blocked by security policy.',
      }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  const response = NextResponse.next();
  const latencyMs = Date.now() - start;

  // 3. Telemetry Forwarding
  const telemetryPromise = fetch(`${COLLECTOR_URL}/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
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

  if (event?.waitUntil) {
    event.waitUntil(telemetryPromise);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};