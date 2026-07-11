import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies(); // ต้อง await ก่อน
  const session = cookieStore.get('admin_session')?.value;
  const isAdmin = !!session && session === process.env.SESSION_SECRET;
  return NextResponse.json({ isAdmin });
}