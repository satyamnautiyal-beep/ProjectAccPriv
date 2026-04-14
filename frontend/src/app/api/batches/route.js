import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

export async function GET() {
  const db = readDb();
  let modified = false;

  for (let batch of db.batches) {
    if (batch.status === 'In Progress') {
      // simulate progress
      batch.progress += Math.floor(Math.random() * 20) + 5;
      if (batch.progress >= 100) {
        batch.progress = 100;
        batch.status = 'Completed';
      }
      modified = true;
    }
  }

  if (modified) writeDb(db);
  return NextResponse.json(db.batches);
}

export async function POST() {
  const db = readDb();
  
  // Find all Ready members that are not already in a batch
  // Note: we'll just pull them based on them being 'Ready'. Let's mark them so they don't get batched twice.
  // We can add `batched: true` to the member.
  const unbatchedReady = db.members.filter(m => m.status === 'Ready' && !m.batched);

  if (unbatchedReady.length === 0) {
    return NextResponse.json({ error: 'No ready members found to batch' }, { status: 400 });
  }

  unbatchedReady.forEach(m => m.batched = true);

  const counts = unbatchedReady.reduce((acc, m) => {
    const type = m.enrollmentType || 'New Enrollment';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  const typesDesc = Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(', ');

  const newBatch = {
    id: `BCH-${Math.floor(1000 + Math.random() * 9000)}`,
    membersCount: unbatchedReady.length,
    types: typesDesc,
    createdAt: new Date().toISOString(),
    status: 'Awaiting Approval',
    progress: 0
  };

  db.batches.unshift(newBatch);
  writeDb(db);

  return NextResponse.json(newBatch);
}
