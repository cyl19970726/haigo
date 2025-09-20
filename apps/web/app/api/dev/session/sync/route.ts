import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { sessionId, maxAgeSeconds } = (await request.json()) as { sessionId?: string; maxAgeSeconds?: number };
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ ok: false, error: 'sessionId is required' }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: 'haigo_session',
      value: encodeURIComponent(sessionId),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Number.isFinite(maxAgeSeconds) ? Number(maxAgeSeconds) : 60 * 60 // 1 hour default
    });
    return res;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

