import { NextResponse } from 'next/server';

import {
  registerLauncherClient,
  touchLauncherClient,
  unregisterLauncherClient,
} from '@/application/launcher-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HeartbeatPayload {
  action?: 'hello' | 'heartbeat' | 'bye';
  client_id?: string;
}

export async function POST(request: Request) {
  let payload: HeartbeatPayload;
  try {
    payload = (await request.json()) as HeartbeatPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid heartbeat payload' }, { status: 400 });
  }

  if (!payload.client_id || !['hello', 'heartbeat', 'bye'].includes(payload.action ?? '')) {
    return NextResponse.json({ error: 'Invalid heartbeat payload' }, { status: 400 });
  }

  if (payload.action === 'hello') registerLauncherClient(payload.client_id);
  else if (payload.action === 'bye') unregisterLauncherClient(payload.client_id);
  else touchLauncherClient(payload.client_id);

  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}

