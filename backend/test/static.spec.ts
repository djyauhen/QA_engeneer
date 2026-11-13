import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultRules } from '../src/rules/rules';
import { safeResolveUnderLanding } from '../src/static/landing-utils';
import { EXPECTED_SVG_SCRIPT_SHA256, runStaticChecks, STATIC_CHECK_NAMES } from '../src/static/static-checks';
import { configuredStandFormHtml, dialCodeForCountries, resolveStandFormHtml, standFormHtml } from '../src/stand/form-html';
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

  it('resolves {{cdn}} links to files under the landing root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const landing = path.join(root, 'landing');
    fs.mkdirSync(path.join(landing, 'js'), { recursive: true });
    fs.mkdirSync(path.join(landing, 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(landing, 'index.html'),
      '<html><head><link rel="stylesheet" href="{{cdn}}/css/app.css"><script src="{{cdn}}/js/app.js"></script><script src="{{cdn}}js/app.js"></script></head><body></body></html>',
    );
    fs.writeFileSync(path.join(landing, 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(landing, 'js', 'app.js'), 'var local = 1;\n');
    fs.writeFileSync(path.join(landing, 'css', 'app.css'), 'body{color:#111}\n');
    try {
      const items = await runStaticChecks(root, defaultRules());
      const linked = items.find((item) => item.name === STATIC_CHECK_NAMES.linked);
      expect(linked?.status).toBe('passed');
      expect(linked?.findings ?? []).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('still reports a missing file when {{cdn}} points at nothing on disk', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const landing = path.join(root, 'landing');
    fs.mkdirSync(path.join(landing, 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(landing, 'index.html'),
      '<html><head><script src="{{cdn}}/missing.js"></script></head><body></body></html>',
    );
    fs.writeFileSync(path.join(landing, 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(landing, 'css', 'app.css'), 'body{color:#111}\n');
    try {
      const items = await runStaticChecks(root, defaultRules());
      const linked = items.find((item) => item.name === STATIC_CHECK_NAMES.linked);
      const text = linked?.findings.map((finding) => finding.text).join('\n') ?? '';
      expect(linked?.status).toBe('failed');
      expect(text).toContain('файл не найден');
      expect(text).toContain('missing.js');
      expect(text).not.toContain('недопустимый путь');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('still fails the cdn prefix check when a css or js url does not start with {{cdn}}/', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const landing = path.join(root, 'landing');
    fs.mkdirSync(path.join(landing, 'css'), { recursive: true });
    fs.mkdirSync(path.join(landing, 'js'), { recursive: true });
    fs.writeFileSync(path.join(landing, 'index.html'), '<html><head></head><body></body></html>');
    fs.writeFileSync(path.join(landing, 'favicon.ico'), 'ico');
    const css = '.bad{background:url(images/a.png)}.ok{background:url({{cdn}}/images/ok.png)}';
    fs.writeFileSync(path.join(landing, 'css', 'app.css'), css);
    fs.writeFileSync(path.join(landing, 'js', 'app.js'), 'var broken = "images/b.png"; var fine = "{{cdn}}/images/ok.webp";');
    try {
      const items = await runStaticChecks(root, defaultRules());
      const cdn = items.find((item) => item.name === STATIC_CHECK_NAMES.cdn);
      const text = cdn?.findings.map((finding) => finding.text).join('\n') ?? '';
      expect(cdn?.status).toBe('failed');
      expect(text).toContain('images/a.png');
      expect(text).toContain('images/b.png');
      expect(text).toContain('не начинается с «{{cdn}}/»');
      expect(text).not.toContain('{{cdn}}/images/ok.png');
      expect(text).not.toContain('{{cdn}}/images/ok.webp');
      expect(fs.readFileSync(path.join(landing, 'css', 'app.css'), 'utf8')).toBe(css);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a favicon and an svg referenced with {{cdn}}, and still flags ?v on that path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const landing = path.join(root, 'landing');
    fs.mkdirSync(path.join(landing, 'js'), { recursive: true });
    fs.mkdirSync(path.join(landing, 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(landing, 'index.html'),
      '<html><head><link rel="icon" href="{{cdn}}/favicon.ico"><script src="{{cdn}}/js/app.js?v=1"></script></head><body><img src="{{cdn}}/guard.svg"></body></html>',
    );
    fs.writeFileSync(path.join(landing, 'css', 'app.css'), 'body{color:#111}\n');
    fs.writeFileSync(path.join(landing, 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(landing, 'guard.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    fs.writeFileSync(path.join(landing, 'js', 'app.js'), 'var local = 1;\n');
    try {
      const items = await runStaticChecks(root, defaultRules());
      const favicon = items.find((item) => item.name === STATIC_CHECK_NAMES.favicon);
      const svg = items.find((item) => item.name === STATIC_CHECK_NAMES.svg);
      const cache = items.find((item) => item.name === STATIC_CHECK_NAMES.cache);
      const linked = items.find((item) => item.name === STATIC_CHECK_NAMES.linked);
      const svgText = svg?.findings.map((finding) => finding.text).join('\n') ?? '';
      const cacheText = cache?.findings.map((finding) => finding.text).join('\n') ?? '';
      expect(favicon?.status).toBe('passed');
      expect(linked?.status).toBe('passed');
      expect(svgText).not.toContain('не найден на диске');
      expect(svgText).toContain('не содержит защитный скрипт');
      expect(cache?.status).toBe('failed');
      expect(cacheText).toContain('{{cdn}}/js/app.js?v=1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('safeResolveUnderLanding', () => {
  const landing = path.join(os.tmpdir(), 'qa-cdn-landing');

  it('maps a leading {{cdn}} onto the landing root and leaves other references alone', () => {
    expect(safeResolveUnderLanding(landing, '{{cdn}}/images/a.png')).toBe(path.resolve(landing, 'images', 'a.png'));
    expect(safeResolveUnderLanding(landing, '{{cdn}}images/a.png')).toBe(path.resolve(landing, 'images', 'a.png'));
    expect(safeResolveUnderLanding(landing, '{{cdn}}/./js/app.js')).toBe(path.resolve(landing, 'js', 'app.js'));
    expect(safeResolveUnderLanding(landing, '{{cdn}}./js/app.js')).toBe(path.resolve(landing, 'js', 'app.js'));
    expect(safeResolveUnderLanding(landing, './{{cdn}}/js/app.js')).toBe(path.resolve(landing, 'js', 'app.js'));
    expect(safeResolveUnderLanding(landing, '{{cdn}}/js/app.js?v=1#section')).toBe(path.resolve(landing, 'js', 'app.js'));
    expect(safeResolveUnderLanding(landing, '{{cdn}}/js/app.js#section?v=1')).toBe(path.resolve(landing, 'js', 'app.js'));
    expect(safeResolveUnderLanding(landing, '{cdn}/js/app.js')).toBe(path.resolve(landing, '{cdn}', 'js', 'app.js'));
    expect(safeResolveUnderLanding(landing, 'https://cdn.example/{{cdn}}/a.js')).toBeNull();
    expect(safeResolveUnderLanding(landing, '//cdn.example/a.js')).toBeNull();
    expect(safeResolveUnderLanding(landing, 'data:image/png;base64,aaaa')).toBeNull();
    expect(safeResolveUnderLanding(landing, '{{cdn}}https://evil.test/a.js')).toBeNull();
    expect(safeResolveUnderLanding(landing, '{{cdn}}//evil.test/a.js')).toBeNull();
    expect(safeResolveUnderLanding(landing, '{{cdn}}/../../secret.js')).toBeNull();
    expect(safeResolveUnderLanding(landing, '{{cdn}}')).toBeNull();
    expect(safeResolveUnderLanding(landing, '{{cdn}}/')).toBeNull();
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

  it('maps the Netherlands and Germany and does not invent a code for an unknown country', () => {
    expect(dialCodeForCountries(['NL'])).toBe('+31');
    expect(dialCodeForCountries(['Netherlands'])).toBe('+31');
    expect(dialCodeForCountries(['Germany'])).toBe('+49');
    expect(dialCodeForCountries(['NL', 'DE'])).toBe('+31');
    expect(dialCodeForCountries(['ZZ', 'PL'])).toBe('+48');
    expect(dialCodeForCountries(['United Kingdom'])).toBe('+44');
    expect(dialCodeForCountries(['UK'])).toBe('+44');
    expect(dialCodeForCountries(['Narnia'])).toBeNull();
    const unknown = standFormHtml(['Narnia']);
    expect(unknown).toContain('type="tel"');
    expect(unknown).toContain('Tel');
    expect(unknown).not.toMatch(/\+\d/);
    expect(standFormHtml(['NL'])).toContain('+31');
    expect(resolveStandFormHtml('<div data-stand-form="1"></div>', ['NL'])).toBe(standFormHtml(['NL']));
    expect(resolveStandFormHtml('<b>CUSTOM</b>', ['NL'])).toBe('<b>CUSTOM</b>');
    expect(configuredStandFormHtml(undefined)).toBe(standFormHtml([]));
    expect(configuredStandFormHtml('<div data-stand-form="1"></div>')).toBe(standFormHtml([]));
    const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    const line = example.split(/\r?\n/).find((row) => row.startsWith('STAND_FORM_HTML='));
    expect(line?.slice('STAND_FORM_HTML='.length)).toBe(standFormHtml([]));
  });

  it('rewrites {{cdn}} inside css and js, where the stand serves those files as text', () => {
    expect(applyCdnMacro('src:url({{cdn}}/fonts/a.woff2)', '/preview/1')).toBe('src:url(/preview/1/fonts/a.woff2)');
    expect(applyCdnMacro('var src="{{cdn}}/images/a.webp"', 'https://stand.test/preview/1')).toBe(
      'var src="https://stand.test/preview/1/images/a.webp"',
    );
  });
});
