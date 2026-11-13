import request from 'supertest';
import { createMemoryRepos } from '../src/storage/memory-repos';
import { createTestApp } from './app';

describe('health', () => {
  it('returns ok when the database answers', async () => {
    const ctx = await createTestApp({ repos: createMemoryRepos() });
    const response = await request(ctx.app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    await ctx.close();
  });

  it('is not 200 and hides the connection string when the database throws', async () => {
    const repos = createMemoryRepos();
    const secret = 'postgresql://qa:secret-pass@db.internal/qa';
    repos.ping = async () => {
      throw new Error(`connect failed ${secret}`);
    };
    const ctx = await createTestApp({ repos });
    const response = await request(ctx.app.getHttpServer()).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'unavailable' });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('secret-pass');
    expect(body).not.toContain('db.internal');
    expect(body).not.toContain('postgresql://');
    await ctx.close();
  });
});
