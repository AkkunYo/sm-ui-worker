import fs from 'node:fs';

const configPath = '.wrangler.generated.jsonc';
const content = fs.readFileSync(configPath, 'utf8');
const databaseId = /"database_id":\s*"([^"]+)"/.exec(content)?.[1] || '';
if (!databaseId || databaseId === 'placeholder-d1-database-id') {
  throw new Error('D1_DATABASE_ID must identify the existing production sm-ui-db before deployment.');
}
console.log(`[validate-deploy-config] Using D1 database ${databaseId}`);
