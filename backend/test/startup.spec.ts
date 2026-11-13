import { listenHost, loadConfig } from '../src/config';
import { corsOrigin } from '../src/configure-app';
import { createPostgresRepos } from '../src/storage/postgres-repos';

describe('startup', () => {
  const required = {
    TL_LOGIN: 'env-tl',
    TL_PASSWORD: 'env-tl-pass',
    AIO_TOKEN: 'test-aio-token-value',
    FINGERPRINT_KEY: 'test-fingerprint-key',
    STORAGE: 'memory',
  };

  it('does not open a database connection while building repos', async () => {
    const repos = await createPostgresRepos('postgresql://USER:PASSWORD@HOST/DB?sslmode=require');
    await repos.close();
  });

  it('refreshes the catalog unless the switch is off', () => {
    expect(loadConfig({ ...required, CATALOG_AUTO_REFRESH: '1' }).catalogAutoRefresh).toBe(true);
    expect(loadConfig({ ...required, CATALOG_AUTO_REFRESH: '0' }).catalogAutoRefresh).toBe(false);
    expect(loadConfig(required).catalogAutoRefresh).toBe(true);
    expect(loadConfig(required).poolMax).toBe(10);
  });

  it('keeps the configured work directory', () => {
    expect(loadConfig({ ...required, WORK_DIR: './data/workdir' }).workDir).toBe('./data/workdir');
    expect(loadConfig(required).workDir).toBe('./data/workdir');
  });

  it('uses only configured frontend origins', () => {
    expect(corsOrigin(['http://localhost:4200'])).toEqual(['http://localhost:4200']);
  });

  it('starts without FRONTEND_ORIGIN on loopback and refuses a public origin', () => {
    const config = loadConfig({
      ...required,
      STORAGE: 'neon',
      DATABASE_URL: 'postgresql://USER:PASSWORD@HOST/DB?sslmode=verify-full',
    });
    expect(config.frontendOrigin).toEqual([]);
    expect(() =>
      loadConfig({
        ...required,
        PUBLIC_BASE_URL: 'https://bdc-it.uk',
      }),
    ).toThrow(/FRONTEND_ORIGIN is required/);
    expect(
      loadConfig({
        ...required,
        PUBLIC_BASE_URL: 'https://bdc-it.uk',
        FRONTEND_ORIGIN: 'https://bdc-it.uk',
      }).frontendOrigin,
    ).toEqual(['https://bdc-it.uk']);
  });

  it('reflects only loopback origins while FRONTEND_ORIGIN is empty', () => {
    const decide = corsOrigin([]);
    expect(typeof decide).toBe('function');
    if (typeof decide !== 'function') return;
    decide('http://localhost:4200', (_err, allow) => expect(allow).toBe(true));
    decide('http://127.0.0.1:4200', (_err, allow) => expect(allow).toBe(true));
    decide('https://evil.example', (_err, allow) => expect(allow).toBe(false));
    decide(undefined, (_err, allow) => expect(allow).toBe(true));
  });

  it('listens only on loopback', () => {
    expect(listenHost({})).toBe('127.0.0.1');
    expect(listenHost({ LISTEN_HOST: 'localhost' })).toBe('127.0.0.1');
    expect(listenHost({ LISTEN_HOST: '::1' })).toBe('127.0.0.1');
    expect(() => listenHost({ LISTEN_HOST: '0.0.0.0' })).toThrow(/LISTEN_HOST must be 127\.0\.0\.1/);
  });
});
