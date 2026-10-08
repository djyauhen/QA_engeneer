import fs from 'fs';
import path from 'path';

describe('repository secrets', () => {
  it('does not keep captured tokens or signed sample urls in the backend tree', () => {
    const root = path.resolve(__dirname, '..');
    const hits: string[] = [];
    const skip = new Set(['node_modules', 'dist', 'coverage', 'data']);
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        if (skip.has(name) || name === 'secrets.spec.ts') continue;
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|js|json|md|example|sql)$/.test(name) && name !== '.env.example') continue;
        const text = fs.readFileSync(full, 'utf8');
        if (/eyJ0eXAiOiJKV1Qi/.test(text) || /digitaloceanspaces/.test(text) || /signature=[A-Za-z0-9]{20,}/.test(text)) {
          hits.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'test'));
    for (const file of ['README.md', '.env.example', 'package.json']) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      if (/eyJ0eXAiOiJKV1Qi/.test(text) || /digitaloceanspaces/.test(text) || /signature=[A-Za-z0-9]{20,}/.test(text)) {
        hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
