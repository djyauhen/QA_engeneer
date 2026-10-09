import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'environments', 'api-base.ts');

const raw = process.env.API_BASE_URL;
let apiBaseUrl = '';
if (raw != null && raw !== '') {
  apiBaseUrl = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (apiBaseUrl !== '' && !apiBaseUrl.startsWith('http://') && !apiBaseUrl.startsWith('https://')) {
    console.error('API_BASE_URL must be empty or start with http:// or https://');
    process.exit(1);
  }
}

const contents = `/** Written by scripts/apply-api-base.mjs. The committed copy keeps an empty string. */
export const apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
`;

writeFileSync(target, contents);
