import { NextResponse } from 'next/server';

export function middleware(request) {
  const { pathname } = request.nextUrl;
  
  if (
    pathname.startsWith('/_next') || 
    pathname.startsWith('/favicon.ico') ||
    pathname === '/login' ||
    pathname === '/api/login' ||
    pathname === '/api/logout'
  ) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get('auth');

  if (!pathname.startsWith('/api') && !authCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
