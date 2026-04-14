import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    if (email === 'admin@demo.com' && password === 'admin123') {
      const cookieStore = cookies();
      cookieStore.set('auth', 'true', { httpOnly: true, secure: process.env.NODE_ENV === 'production', path: '/' });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  } catch (e) {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
