import { loadConfig } from '../src/config';
import { corsOrigin } from '../src/configure-app';
import { createPostgresRepos } from '../src/storage/postgres-repos';

describe('startup', () => {
  const required = {
    TL_LOGIN: 'env-tl',
    TL_PASSWORD: 'env-tl-pass',
    AIO_TOKEN: 'test-aio-token-value',
    STORAGE: 'memory',
  };

  it('does not open a database connection while building repos', async () => {
    const repos = await createPostgresRepos('postgresql://USER:PASSWORD@HOST/DB?sslmode=require');
    await repos.close();
  });

  it('skips the in-process catalog timer on Vercel', () => {
    const config = loadConfig({ ...required, VERCEL: '1', CATALOG_AUTO_REFRESH: '1' });
    expect(config.catalogAutoRefresh).toBe(false);
  });

  it('keeps the deployed frontend origin when FRONTEND_ORIGIN is set', () => {
    expect(corsOrigin(['http://localhost:4200'])).toEqual([
      'http://localhost:4200',
      'https://qa-engeneer.vercel.app',
    ]);
  });

  it('reflects any origin while FRONTEND_ORIGIN is empty', () => {
    expect(corsOrigin([])).toBe(true);
  });
});
