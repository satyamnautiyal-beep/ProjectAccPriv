import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

export async function GET() {
  const db = readDb();
  return NextResponse.json(db.clarifications);
}

export async function PATCH(request) {
  try {
    const { id } = await request.json();
    const db = readDb();
    
    const clr = db.clarifications.find(c => c.id === id);
    if (!clr) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (clr.status === 'Awaiting Response') {
      clr.status = 'Response Received';
    } else if (clr.status === 'Response Received') {
      clr.status = 'Resolved';
      
      // Update the underlying member!
      const member = db.members.find(m => m.id === clr.memberId);
      if (member) {
        member.status = 'Ready';
        member.needsClarification = false;
      }
    }

    writeDb(db);
    return NextResponse.json(clr);
  } catch (err) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
