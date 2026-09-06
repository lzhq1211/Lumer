'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 5_000;

function sendHeartbeat(action: 'hello' | 'heartbeat' | 'bye', clientId: string, keepalive = false) {
  const body = JSON.stringify({ action, client_id: clientId });
  if (action === 'bye' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/launcher/heartbeat', new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch('/api/launcher/heartbeat', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    keepalive,
  }).catch(() => undefined);
}

export function LauncherLifecycle() {
  useEffect(() => {
    const clientId = crypto.randomUUID();
    sendHeartbeat('hello', clientId);

    const heartbeatTimer = window.setInterval(() => {
      sendHeartbeat('heartbeat', clientId, true);
    }, HEARTBEAT_INTERVAL_MS);
    const handlePageHide = () => sendHeartbeat('bye', clientId, true);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('pagehide', handlePageHide);
      sendHeartbeat('bye', clientId, true);
    };
  }, []);

  return null;
}

