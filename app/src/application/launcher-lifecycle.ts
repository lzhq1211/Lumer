const HEARTBEAT_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 2_000;

const clients = new Map<string, number>();
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

function autoStopEnabled() {
  return process.env.LUMER_AUTO_STOP === '1';
}

function pruneExpiredClients(now = Date.now()) {
  for (const [clientId, lastSeenAt] of clients) {
    if (now - lastSeenAt > HEARTBEAT_TIMEOUT_MS) clients.delete(clientId);
  }
}

function scheduleShutdown() {
  if (!autoStopEnabled() || shutdownTimer || clients.size > 0) return;

  shutdownTimer = setTimeout(() => {
    shutdownTimer = null;
    pruneExpiredClients();
    if (clients.size === 0) process.exit(0);
  }, SHUTDOWN_GRACE_MS);
}

export function registerLauncherClient(clientId: string) {
  clients.set(clientId, Date.now());
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

export function unregisterLauncherClient(clientId: string) {
  clients.delete(clientId);
  scheduleShutdown();
}

export function touchLauncherClient(clientId: string) {
  if (clients.has(clientId)) clients.set(clientId, Date.now());
  else registerLauncherClient(clientId);
}

export function reapLauncherClients() {
  pruneExpiredClients();
  scheduleShutdown();
}

