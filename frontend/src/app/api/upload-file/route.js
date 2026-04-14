import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

function generateRandomName() {
  const firsts = ['John', 'Sarah', 'Emily', 'Michael', 'David', 'Jessica', 'Marcus', 'Chloe', 'James', 'Linda'];
  const lasts = ['Connor', 'Doe', 'Smith', 'Davis', 'Johnson', 'Williams', 'Brown', 'Taylor', 'Wilson', 'Moore'];
  return `${firsts[Math.floor(Math.random()*firsts.length)]} ${lasts[Math.floor(Math.random()*lasts.length)]}`;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const db = readDb();
    
    const numMembers = Math.floor(Math.random() * 50) + 10;
    
    // Simulate structural decision gate
    const fileStructureValid = Math.random() > 0.4; // 60% probability of valid structure
    
    const newFile = {
      id: Date.now().toString(),
      fileName: file.name,
      uploadTime: new Date().toISOString(),
      status: fileStructureValid ? 'Parsing' : 'Invalid',
      membersCount: fileStructureValid ? numMembers : 0
    };
    db.files.unshift(newFile);

    if (!fileStructureValid) {
       writeDb(db);
       return NextResponse.json({ valid: false, file: newFile });
    }

    const enrollmentTypes = ['New Enrollment', 'Updates', 'Termination'];
    
    for(let i = 0; i < numMembers; i++) {
      const rand = Math.random();
      let status = 'Ready';
      let needsClarification = false;
      
      if (rand > 0.90) {
        status = 'Awaiting Input';
        needsClarification = true;
      } else if (rand > 0.85) {
        status = 'Cannot Process';
      } else if (rand > 0.70) {
        status = 'Under Review';
      }

      const memberId = `MEM-${Date.now()}-${i}`;
      const newMember = {
        id: memberId,
        name: generateRandomName(),
        enrollmentType: enrollmentTypes[Math.floor(Math.random() * enrollmentTypes.length)],
        status,
        needsClarification,
        fileId: newFile.id
      };
      
      db.members.unshift(newMember);

      if (needsClarification) {
        const issues = ['Address Verification', 'Dependent DOB', 'SSN Mismatch', 'Missing Date of Birth', 'Proof of Life Event'];
        db.clarifications.unshift({
          id: `CLR-${Date.now()}-${i}`,
          memberId,
          memberName: newMember.name,
          issueType: issues[Math.floor(Math.random() * issues.length)],
          status: 'Awaiting Response'
        });
      }
    }

    writeDb(db);
    return NextResponse.json({ valid: true, file: newFile });
  } catch (err) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
