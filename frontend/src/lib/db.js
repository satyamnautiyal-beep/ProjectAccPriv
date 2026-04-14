import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data.json');

// Initialize DB if not exists
if (!fs.existsSync(dbPath)) {
  const initialData = {
    files: [],
    members: [],
    clarifications: [],
    batches: []
  };
  fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
}

export const readDb = () => {
  const data = fs.readFileSync(dbPath, 'utf8');
  return JSON.parse(data);
};

export const writeDb = (data) => {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};
