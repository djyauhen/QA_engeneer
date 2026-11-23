import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultRules } from '../src/rules/rules';
import { isLandingResolveError, safeResolveUnderLanding } from '../src/static/landing-utils';
import {
  EXPECTED_SVG_SCRIPT_SHA256,
  MERGED_SPLIT_UNAVAILABLE,
  STATIC_CHECK_NAMES,
  checkRequiredSplits,
  runStaticChecks,
} from '../src/static/static-checks';
import { cleanLandingFiles } from './fakes';
import { configuredStandFormHtml, dialCodeForCountries, resolveStandFormHtml, standFormHtml } from '../src/stand/form-html';
import { applyCdnMacro, rewriteCssAssets, stampCdnUrls, transformHtml } from '../src/stand/transform';

const STATIC_RUN_ORDER = [
  STATIC_CHECK_NAMES.structure,
  STATIC_CHECK_NAMES.php,
  STATIC_CHECK_NAMES.images,
  STATIC_CHECK_NAMES.linked,
  STATIC_CHECK_NAMES.external,
  STATIC_CHECK_NAMES.dates,
  STATIC_CHECK_NAMES.utf8,
  STATIC_CHECK_NAMES.favicon,
  STATIC_CHECK_NAMES.stealer,
  STATIC_CHECK_NAMES.style,
  STATIC_CHECK_NAMES.legacy,
  STATIC_CHECK_NAMES.form,
  STATIC_CHECK_NAMES.tracker,
  STATIC_CHECK_NAMES.svg,
  STATIC_CHECK_NAMES.cache,
  STATIC_CHECK_NAMES.scripts,
  STATIC_CHECK_NAMES.css,
  STATIC_CHECK_NAMES.unwanted,
  STATIC_CHECK_NAMES.base64,
  STATIC_CHECK_NAMES.cdn,
];

describe('static checks', () => {
  it('still runs later checks when the landing folder cannot be resolved', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    fs.mkdirSync(path.join(root, 'one'));
    fs.mkdirSync(path.join(root, 'two'));
    try {
      const items = await runStaticChecks(root, defaultRules());
      expect(items.map((item) => item.name)).toEqual(STATIC_RUN_ORDER);
      expect(items[0].status).toBe('failed');
      expect(items[0].findings[0]?.text.startsWith('Ожидается одна папка с лендингом')).toBe(true);
      const php = items.find((item) => item.name === STATIC_CHECK_NAMES.php);
      expect(php?.status).toBe('failed');
      expect(php?.findings.every((finding) => finding.text.startsWith('Ожидается одна папка с лендингом'))).toBe(true);
      const unread = await runStaticChecks(path.join(root, 'missing'), defaultRules());
      expect(unread.map((item) => item.name)).toEqual(STATIC_RUN_ORDER);
      expect(unread[0].status).toBe('failed');
      expect(unread.find((item) => item.name === STATIC_CHECK_NAMES.php)?.findings[0]?.text.startsWith('Не удалось прочитать каталог')).toBe(
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('still runs later checks when structure fails inside a resolved landing folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const landing = path.join(root, 'landing');
    fs.mkdirSync(path.join(landing, 'css'), { recursive: true });
    fs.writeFileSync(path.join(landing, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(landing, 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(landing, 'css', 'app.css'), 'body{}\n');
    fs.writeFileSync(path.join(landing, 'notes.txt'), 'extra');
    try {
      const items = await runStaticChecks(root, defaultRules());
      expect(items.map((item) => item.name)).toEqual(STATIC_RUN_ORDER);
      expect(items[0].status).toBe('failed');
      expect(items[0].findings.some((finding) => finding.text.includes('notes.txt'))).toBe(true);
      const php = items.find((item) => item.name === STATIC_CHECK_NAMES.php);
      expect(php?.status).toBe('passed');
      expect(php?.findings ?? []).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('still runs later checks when the landing root has an extra assets folder', async () => {
    const plainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
    const write = (root: string, withAssets: boolean) => {
      for (const [name, data] of Object.entries(cleanLandingFiles(withAssets))) {
        const full = path.join(root, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
      }
    };
    write(plainRoot, false);
    write(assetsRoot, true);
    try {
      const rules = defaultRules();
      const plain = await runStaticChecks(plainRoot, rules);
      const withAssets = await runStaticChecks(assetsRoot, rules);
      expect(withAssets.map((item) => item.name)).toEqual(STATIC_RUN_ORDER);
      const structure = withAssets.find((item) => item.name === STATIC_CHECK_NAMES.structure);
      expect(structure?.status).toBe('failed');
      expect(structure?.findings.some((finding) => finding.text.includes('assets'))).toBe(true);
      expect(plain.filter((item) => item.status === 'failed').map((item) => item.name)).toEqual([STATIC_CHECK_NAMES.svg]);
      for (const item of withAssets) {
        if (item.name === STATIC_CHECK_NAMES.structure) continue;
        const other = plain.find((entry) => entry.name === item.name);
        expect(item.status).toBe(other?.status);
        expect(item.findings).toEqual(other?.findings ?? []);
      }
    } finally {
      fs.rmSync(plainRoot, { recursive: true, force: true });
      fs.rmSync(assetsRoot, { recursive: true, force: true });
    }
  });

  it('treats only the landing-folder resolve messages as echoes', () => {
    expect(isLandingResolveError('Ожидается одна папка с лендингом в «/tmp», найдено подпапок: 2')).toBe(true);
    expect(isLandingResolveError('Не удалось прочитать каталог: /tmp/missing')).toBe(true);
    expect(
      isLandingResolveError(
        'Не удалось прочитать каталог: /tmp/a; Ожидается одна папка с лендингом в «/tmp/b», найдено подпапок: 0',
      ),
    ).toBe(true);
    expect(
      isLandingResolveError('Ожидается одна папка с лендингом в «/tmp», найдено подпапок: 2; Не найден файл index.html или index.php'),
    ).toBe(false);
    expect(isLandingResolveError('index.html: обнаружены вставки PHP')).toBe(false);
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

  it('serves a captured page with its stylesheet, images and preview token', () => {
    const source = `<html><head>
      <base href="https://www.index.hr/">
      <link rel="stylesheet" href="./css/style.css">
      <style>.hero{background:url(./images/bg.png)} .root{background:url(/images/root.png)}</style>
    </head><body>
      <img src="./images/logo.png" alt="index.hr" srcset="./images/logo.png 1x, /images/logo-2.png 2x">
      <img src="https://cdn.index.hr/hotlink.png" alt="hot">
      <script src="https://evil.test/p.js"></script>
      <script src="js/local.js"></script>
    </body></html>`;
    const out = transformHtml(source, {
      formHtml: '<b>FORM</b>',
      brandName: 'Acme',
      cdnBase: 'https://bdc-it.uk/preview/check',
      isolated: true,
      previewToken: 'tok',
    });
    expect(out).toContain('<base href="https://bdc-it.uk/preview/check/">');
    expect(out).not.toContain('https://www.index.hr/');
    expect(out).toContain('href="https://bdc-it.uk/preview/check/css/style.css?t=tok"');
    expect(out).toContain('src="https://bdc-it.uk/preview/check/images/logo.png?t=tok"');
    expect(out).toContain('https://bdc-it.uk/preview/check/images/logo-2.png?t=tok');
    expect(out).toContain('url(https://bdc-it.uk/preview/check/images/bg.png?t=tok)');
    expect(out).toContain('url(https://bdc-it.uk/preview/check/images/root.png?t=tok)');
    expect(out).toContain('https://cdn.index.hr/hotlink.png');
    expect(out).not.toContain('evil.test/p.js');
    expect(out).toContain('https://bdc-it.uk/preview/check/js/local.js?t=tok');
    expect(out).toContain('window.__CDN_BASE__="https://bdc-it.uk/preview/check"');
    const css = rewriteCssAssets(applyCdnMacro("src:url('{{cdn}}/fonts/a.woff2');.b{background:url('../images/a.png')}", 'https://bdc-it.uk/preview/check'), {
      assetRoot: 'https://bdc-it.uk/preview/check',
      pageUrl: 'https://bdc-it.uk/preview/check/css/style.css',
      previewToken: 'tok',
    });
    expect(css).toContain("url('https://bdc-it.uk/preview/check/fonts/a.woff2?t=tok')");
    expect(css).toContain("url('https://bdc-it.uk/preview/check/images/a.png?t=tok')");
    expect(rewriteCssAssets('background:url("data:image/svg+xml,abc")', { assetRoot: 'https://bdc-it.uk/preview/check' })).toContain(
      'data:image/svg+xml,abc',
    );
    expect(stampCdnUrls(applyCdnMacro('var src="{{cdn}}/images/a.webp"', 'https://bdc-it.uk/preview/check'), 'https://bdc-it.uk/preview/check', 'tok')).toBe(
      'var src="https://bdc-it.uk/preview/check/images/a.webp?t=tok"',
    );
    expect(stampCdnUrls('window.__CDN_BASE__="https://bdc-it.uk/preview/check"', 'https://bdc-it.uk/preview/check', 'tok')).toBe(
      'window.__CDN_BASE__="https://bdc-it.uk/preview/check"',
    );
  });

  it('rewrites index.hr asset URLs that exist in the archive and leaves the live publisher alone', () => {
    const archived = new Set(['/css/style.css', '/images/5e444464-index_main.svg', '/images/134598b8-paprika_logo.svg']);
    const source = `<html><head>
      <link rel="stylesheet" href="./css/style.css">
      <link rel="stylesheet" href="https://www.index.hr/css/style.css">
      <link rel="stylesheet" href="//www.index.hr/css/missing.css">
    </head><body>
      <img src="./images/5e444464-index_main.svg" alt="index.hr">
      <img src="//www.index.hr/images/134598b8-paprika_logo.svg" alt="index.hr">
      <a href="https://www.index.hr/vijesti">Vijesti</a>
    </body></html>`;
    const out = transformHtml(source, {
      formHtml: '',
      brandName: 'Acme',
      cdnBase: 'https://bdc-it.uk/preview/check',
      isolated: true,
      previewToken: 'tok',
      assetExists: (pathname) => archived.has(pathname),
    });
    expect(out).toContain('href="https://bdc-it.uk/preview/check/css/style.css?t=tok"');
    expect(out).toContain('src="https://bdc-it.uk/preview/check/images/5e444464-index_main.svg?t=tok"');
    expect(out).toContain('src="https://bdc-it.uk/preview/check/images/134598b8-paprika_logo.svg?t=tok"');
    expect(out).not.toContain('www.index.hr/css/style.css');
    expect(out).not.toContain('www.index.hr/images/');
    expect(out).toContain('//www.index.hr/css/missing.css');
    expect(out).toContain('https://www.index.hr/vijesti');
    const untouched = transformHtml('<img src="//www.index.hr/images/134598b8-paprika_logo.svg" alt="index.hr">', {
      formHtml: '',
      brandName: 'Acme',
      cdnBase: 'https://bdc-it.uk/preview/check',
      isolated: true,
      previewToken: 'tok',
    });
    expect(untouched).toContain('//www.index.hr/images/134598b8-paprika_logo.svg');
    const css = rewriteCssAssets(
      '.a{background:url(../images/5e444464-index_main.svg)}.b{background:url(//www.index.hr/images/134598b8-paprika_logo.svg)}@font-face{src:url(https://fonts.gstatic.com/s/notocoloremoji/v40/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFab4.ttf)}',
      {
        assetRoot: 'https://bdc-it.uk/preview/check',
        pageUrl: 'https://bdc-it.uk/preview/check/css/style.css',
        previewToken: 'tok',
        assetExists: (pathname) => archived.has(pathname),
      },
    );
    expect(css).toContain('url(https://bdc-it.uk/preview/check/images/5e444464-index_main.svg?t=tok)');
    expect(css).toContain('url(https://bdc-it.uk/preview/check/images/134598b8-paprika_logo.svg?t=tok)');
    expect(css).toContain('https://fonts.gstatic.com/s/notocoloremoji/v40/Yq6P-KqIXTD0t4D9z1ESnKM3-HpFab4.ttf');
    expect(css).not.toContain('www.index.hr');
  });
});

describe('required split macros', () => {
  function landing(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-split-'));
    const folder = path.join(root, 'landing');
    fs.mkdirSync(folder);
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(folder, name), body);
    }
    return root;
  }

  async function run(files: Record<string, string>) {
    const root = landing(files);
    try {
      return await checkRequiredSplits(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('passes when the required macros are present and the subtitle is absent', async () => {
    const result = await run({
      'index.html': '<html>{{split.title}}</html>',
      'index.php': '{{split.bannerUrl}}',
    });
    expect(result).toEqual({ name: STATIC_CHECK_NAMES.split, status: 'passed', findings: [] });
  });

  it('passes when the subtitle is present', async () => {
    const result = await run({
      'index.php': '{{split.title}}\n{{split.subtitle}}\n{{split.bannerUrl}}\n',
    });
    expect(result).toEqual({ name: STATIC_CHECK_NAMES.split, status: 'passed', findings: [] });
  });

  it('fails when the title macro is missing and names that macro', async () => {
    const result = await run({
      'index.html': '{{split.Title}}\n{{split.bannerUrl}}\n',
    });
    expect(result.status).toBe('failed');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].text).toContain('{{split.title}}');
    expect(result.findings[0].text).not.toContain('{{split.bannerUrl}}');
    expect(result.findings[0].text).not.toContain('subtitle');
    expect(result.findings[0].text).not.toMatch(/стр\./);
  });

  it('fails when the banner macro is missing and names that macro', async () => {
    const result = await run({
      'index.html': '{{split.title}}\n{{split.bannerurl}}\n{{split.subtitle}}\n',
    });
    expect(result.status).toBe('failed');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].text).toContain('{{split.bannerUrl}}');
    expect(result.findings[0].text).not.toContain('{{split.title}}');
    expect(result.findings[0].text).not.toContain('subtitle');
  });

  it('fails with both required macros when each one is missing', async () => {
    const result = await run({
      'index.html': '<html>{{split.subtitle}}</html>',
    });
    expect(result.status).toBe('failed');
    expect(result.findings).toHaveLength(2);
    const text = result.findings.map((finding) => finding.text).join('\n');
    expect(text).toContain('{{split.title}}');
    expect(text).toContain('{{split.bannerUrl}}');
    expect(text).not.toContain('subtitle');
  });

  it('fails when the merged archive is unavailable', async () => {
    const result = await checkRequiredSplits(null);
    expect(result.status).toBe('failed');
    expect(result.name).toBe(STATIC_CHECK_NAMES.split);
    expect(result.findings).toEqual([{ text: MERGED_SPLIT_UNAVAILABLE }]);
  });
});
