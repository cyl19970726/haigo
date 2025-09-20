import { NextResponse, type NextRequest } from 'next/server';

const ZH_PREFIX = /^\/zh(\/|$)/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ZH_PREFIX.test(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = pathname.replace(/^\/zh/, '') || '/';
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|assets|favicon\\.ico|.*\\.[^/]+$).*)']
};
