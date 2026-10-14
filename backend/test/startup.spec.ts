import os from 'os';
import path from 'path';
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

  it('unpacks into the instance temp directory on Vercel', () => {
    const deployed = loadConfig({ ...required, VERCEL: '1', WORK_DIR: './data/workdir' });
    expect(deployed.workDir).toBe(path.join(os.tmpdir(), 'qa-workdir'));
    const custom = loadConfig({ ...required, VERCEL: '1', WORK_DIR: path.join(os.tmpdir(), 'custom-work') });
    expect(custom.workDir).toBe(path.join(os.tmpdir(), 'custom-work'));
    const local = loadConfig({ ...required, WORK_DIR: './data/workdir' });
    expect(local.workDir).toBe('./data/workdir');
  });

  it('uses only configured frontend origins', () => {
    expect(corsOrigin(['http://localhost:4200'])).toEqual(['http://localhost:4200']);
  });

  it('requires FRONTEND_ORIGIN for a Vercel deploy with Neon', () => {
    expect(() =>
      loadConfig({
        ...required,
        STORAGE: 'neon',
        DATABASE_URL: 'postgresql://USER:PASSWORD@HOST/DB?sslmode=verify-full',
        VERCEL: '1',
      }),
    ).toThrow(/FRONTEND_ORIGIN is required/);
  });

  it('reflects any origin while FRONTEND_ORIGIN is empty', () => {
    expect(corsOrigin([])).toBe(true);
  });
});
