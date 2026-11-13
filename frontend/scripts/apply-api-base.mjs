import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'environments', 'api-base.ts');

const DEFAULT_API_BASE_URL = 'https://bdc-it.uk';

const raw = process.env.API_BASE_URL;
const apiBaseUrl = raw == null || raw === '' ? DEFAULT_API_BASE_URL : raw;
if (apiBaseUrl.endsWith('/')) {
  console.error('API_BASE_URL must not have a trailing slash');
  process.exit(1);
}
if (!apiBaseUrl.startsWith('https://')) {
  console.error('API_BASE_URL must be https:// without a trailing slash. Port 3000 is not public.');
  process.exit(1);
}
if (apiBaseUrl.includes(':3000')) {
  console.error('API_BASE_URL must not use port 3000');
  process.exit(1);
}

const contents = `/** Written by scripts/apply-api-base.mjs. Defaults to https://bdc-it.uk; set API_BASE_URL to override. */
export const apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
`;

writeFileSync(target, contents);
