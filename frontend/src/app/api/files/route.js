import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

export async function GET() {
  const db = readDb();
  let modified = false;
  
  const now = Date.now();
  for (let file of db.files) {
    if (file.status === 'Parsing' && (now - new Date(file.uploadTime).getTime()) > 5000) {
      const hasErrors = db.members.some(m => m.fileId === file.id && (m.status === 'Needs Clarification' || m.status === 'Awaiting Input'));
      if (hasErrors) {
        file.status = 'Blocking Issue';
      } else {
        file.status = 'Clean';
      }
      modified = true;
    }
  }

  if (modified) writeDb(db);
  
  return NextResponse.json(db.files);
}
