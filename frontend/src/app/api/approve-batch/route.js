import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

export async function POST(request) {
  try {
    const { id, action } = await request.json();
    const db = readDb();
    
    const batch = db.batches.find(b => b.id === id);
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

    if (action === 'approve') {
      batch.status = 'In Progress';
      batch.progress = 5;
    } else if (action === 'hold') {
      batch.status = 'On Hold';
    }

    writeDb(db);
    return NextResponse.json(batch);
  } catch (err) {
    return NextResponse.json({ error: 'Approval failed' }, { status: 500 });
  }
}
