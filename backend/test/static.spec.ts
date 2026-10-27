import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultRules } from '../src/rules/rules';
import { EXPECTED_SVG_SCRIPT_SHA256, runStaticChecks, STATIC_CHECK_NAMES } from '../src/static/static-checks';
import { applyCdnMacro, transformHtml } from '../src/stand/transform';

describe('static checks', () => {
  it('does not run later checks when structure fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    fs.mkdirSync(path.join(root, 'one'));
    fs.mkdirSync(path.join(root, 'two'));
    const items = await runStaticChecks(root, defaultRules());
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe(STATIC_CHECK_NAMES.structure);
    expect(items[0].status).toBe('failed');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses the image and css thresholds from config and flags a disallowed external url', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const landing = path.join(root, 'landing');
    fs.mkdirSync(path.join(landing, 'images'), { recursive: true });
    fs.mkdirSync(path.join(landing, 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(landing, 'index.html'),
      '<html><head><meta charset="UTF-8"></head><body><svg>https://evil.test/in-svg</svg><a href="https://evil.test/out">x</a></body></html>',
    );
    fs.writeFileSync(path.join(landing, 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(landing, 'images', 'big.png'), Buffer.alloc(200 * 1024 + 10));
    fs.writeFileSync(path.join(landing, 'images', 'mid.png'), Buffer.alloc(100 * 1024 + 10));
    fs.writeFileSync(path.join(landing, 'css', 'app.css'), Buffer.alloc(60 * 1024));
    const items = await runStaticChecks(root, defaultRules());
    const images = items.find((item) => item.name === STATIC_CHECK_NAMES.images);
    const css = items.find((item) => item.name === STATIC_CHECK_NAMES.css);
    const external = items.find((item) => item.name === STATIC_CHECK_NAMES.external);
    expect(images?.status).toBe('failed');
    expect(images?.findings.some((finding) => finding.text.includes('big.png'))).toBe(true);
    expect(images?.findings.some((finding) => finding.text.includes('mid.png'))).toBe(true);
    expect(css?.status).toBe('warning');
    const externalText = external?.findings.map((finding) => finding.text).join('\n') ?? '';
    expect(externalText).toContain('/out');
    expect(externalText).not.toContain('in-svg');
    expect(items.map((item) => item.name)).not.toContain('overall_status');
    expect(EXPECTED_SVG_SCRIPT_SHA256).toBe('1fdc077086ee808c187d7a613348f197ba0f15625c70090b2d43e8983ad4ff50');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('stand macros', () => {
  it('substitutes the three stand macros and isolates external scripts until allow', () => {
    const source = '<html><head></head><body>{{form}} {{aio.visit.fields.offer_name.for_visitors}} {{cdn}}/a.png {{link}}<script src="https://evil.test/p.js"></script><script src="js/a.js"></script><form action="https://evil.test/lead"></form></body></html>';
    const isolated = transformHtml(source, {
      formHtml: '<b>FORM</b>',
      brandName: 'Acme',
      cdnBase: '/cdn',
      isolated: true,
    });
    expect(isolated).toContain('<b>FORM</b>');
    expect(isolated).toContain('Acme');
    expect(isolated).toContain('/cdn/a.png');
    expect(isolated).toContain('{{link}}');
    expect(isolated).toContain('window.__CDN_BASE__');
    expect(isolated).not.toContain('evil.test/p.js');
    expect(isolated).toContain('js/a.js');
    expect(isolated).toContain('data-stand-isolated="1"');
    expect(isolated).toContain('onsubmit="return false"');
    expect(isolated).not.toContain('action=');
    const open = transformHtml(source, {
      formHtml: '<b>FORM</b>',
      brandName: 'Acme',
      cdnBase: '/cdn',
      isolated: false,
    });
    expect(open).toContain('evil.test/p.js');
    expect(open).not.toContain('data-stand-isolated');
  });

  it('rewrites {{cdn}} inside css and js, where the stand serves those files as text', () => {
    expect(applyCdnMacro('src:url({{cdn}}/fonts/a.woff2)', '/preview/1')).toBe('src:url(/preview/1/fonts/a.woff2)');
    expect(applyCdnMacro('var src="{{cdn}}/images/a.webp"', 'https://stand.test/preview/1')).toBe(
      'var src="https://stand.test/preview/1/images/a.webp"',
    );
  });
});
