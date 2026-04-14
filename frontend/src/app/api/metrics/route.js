import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';

export async function GET() {
  const db = readDb();

  const filesToday = db.files.length;
  const membersIdentified = db.members.length;
  
  const readyCount = db.members.filter(m => m.status === 'Ready').length;
  const pendingCount = db.members.filter(m => m.status === 'Needs Clarification' || m.status === 'Awaiting Input' || m.status === 'Under Review').length;
  const blockedCount = db.members.filter(m => m.status === 'Cannot Process').length;

  const awaitingClarification = db.clarifications.filter(c => c.status !== 'Resolved').length;
  const inProgressBatches = db.batches.filter(b => b.status === 'In Progress').length;
  const completedBatches = db.batches.filter(b => b.status === 'Completed').length;

  return NextResponse.json({
    kpis: {
      filesToday,
      membersIdentified,
      readyCount,
      pendingCount,
      blockedCount,
      awaitingClarification,
      inProgressBatches,
      completedBatches
    },
    pieData: [
      { name: 'Ready', value: readyCount || 1, color: '#22c55e' },
      { name: 'Pending', value: pendingCount || 1, color: '#f59e0b' },
      { name: 'Awaiting Input', value: awaitingClarification || 1, color: '#2563eb' },
      { name: 'Blocked', value: blockedCount || 1, color: '#ef4444' }
    ]
  });
}
