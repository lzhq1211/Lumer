import { NextResponse } from 'next/server';
import { getCodexCliAvailability } from '@/lib/ai-providers/codex-analyze-adapter';

// GET /api/auth/status — Check if authenticated
export async function GET() {
  return NextResponse.json(await getCodexCliAvailability());
}

// DELETE /api/auth/status — Managed by Codex, so Lumer does not clear it.
export async function DELETE() {
  return NextResponse.json(
    {
      success: false,
      error: 'Lumer uses the existing Codex login on this machine. Sign out from Codex if you want to disconnect it here.',
    },
    { status: 400 }
  );
}
