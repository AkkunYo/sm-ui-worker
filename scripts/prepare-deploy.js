import fs from 'node:fs';
import path from 'node:path';

const databaseId = process.env.D1_DATABASE_ID;
const filePath = path.resolve(process.cwd(), 'wrangler.jsonc');

if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');

  if (databaseId && databaseId.trim()) {
    content = content.replace(
      /"database_id":\s*"[^"]*"/,
      `"database_id": "${databaseId.trim()}"`
    );
    console.log(`[prepare-deploy] Injected D1_DATABASE_ID (${databaseId.trim()}) into wrangler.jsonc`);
  } else {
    // If no D1_DATABASE_ID is provided, strip d1_databases from wrangler.jsonc
    // so Wrangler automatically inherits the pre-configured Dashboard binding without ID mismatch.
    content = content.replace(/,\s*"d1_databases":\s*\[[\s\S]*?\]/, '');
    console.log('[prepare-deploy] No D1_DATABASE_ID specified. Stripped d1_databases block to use Cloudflare Dashboard binding.');
  }

  fs.writeFileSync(filePath, content, 'utf8');
}
