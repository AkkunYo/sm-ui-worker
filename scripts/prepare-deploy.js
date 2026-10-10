import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(process.cwd(), 'wrangler.jsonc');
const generatedPath = path.resolve(process.cwd(), '.wrangler.generated.jsonc');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing Wrangler source config: ${sourcePath}`);
}

let content = fs.readFileSync(sourcePath, 'utf8');
const databaseId = (process.env.D1_DATABASE_ID || '').trim();
if (databaseId) {
  content = content.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${databaseId}"`);
}

fs.writeFileSync(generatedPath, content, 'utf8');
console.log(`[prepare-deploy] Generated ${path.basename(generatedPath)}; source wrangler.jsonc was not modified.`);
