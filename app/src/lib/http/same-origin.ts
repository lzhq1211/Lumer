import { NextRequest } from 'next/server';

export function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto')
      || request.nextUrl.protocol.replace(':', '');
    const requestOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
    return new URL(origin).origin === new URL(requestOrigin).origin;
  } catch {
    return false;
  }
}
