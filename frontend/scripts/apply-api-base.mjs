import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'environments', 'api-base.ts');

const DEFAULT_API_BASE_URL = 'https://backend-chi-six-58.vercel.app';

const raw = process.env.API_BASE_URL;
let apiBaseUrl = DEFAULT_API_BASE_URL;
if (raw != null && raw !== '') {
  apiBaseUrl = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (!apiBaseUrl.startsWith('http://') && !apiBaseUrl.startsWith('https://')) {
    console.error('API_BASE_URL must start with http:// or https://');
    process.exit(1);
  }
}

const contents = `/** Written by scripts/apply-api-base.mjs. Defaults to the deployed API; set API_BASE_URL to override. */
export const apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
`;

writeFileSync(target, contents);
