/** Replaces the archive macro. CSS and JS are not HTML, but they use the same token in url() and strings. */
export function applyCdnMacro(source: string, cdnBase: string): string {
  return source.split('{{cdn}}').join(cdnBase);
}

export function transformHtml(
  html: string,
  options: {
    formHtml: string;
    brandName: string;
    cdnBase: string;
    isolated: boolean;
    previewToken?: string;
    /** Pathname (`/css/a.css`) is a file in the landing archive. External hosts are not fetched. */
    assetExists?: (pathname: string) => boolean;
  },
): string {
  let out = html.split('{{form}}').join(options.formHtml);
  out = out.split('{{aio.visit.fields.offer_name.for_visitors}}').join(options.brandName);
  out = applyCdnMacro(out, options.cdnBase);
  const injection = `<script>window.__CDN_BASE__=${JSON.stringify(options.cdnBase)};</script>`;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (match) => `${match}${injection}`);
  else out = injection + out;
  if (options.isolated) out = isolate(out);
  return rewriteHtmlAssets(out, {
    assetRoot: options.cdnBase,
    previewToken: options.previewToken,
    assetExists: options.assetExists,
  });
}

/**
 * Absolute stand URLs so a document served under /preview/{id}/ still loads landing files.
 * Root-relative paths (`/css/a.css`) are landing-root paths, not host-root paths.
 */
export function absolutizeRelativeUrls(html: string, base: string): string {
  return rewriteHtmlAssets(html, { assetRoot: base });
}

export interface AssetRewriteOptions {
  /** Preview folder, no trailing slash. Absolute URL or path (`/preview/id`). */
  assetRoot: string;
  /** URL relative references resolve against. Defaults to the preview folder. For a stylesheet, pass that file's URL. */
  pageUrl?: string;
  previewToken?: string;
  /** True when `pathname` (leading slash, no query) is a file inside the landing archive. */
  assetExists?: (pathname: string) => boolean;
}

const PLACEHOLDER_ORIGIN = 'http://preview.local';
const URL_ATTR = String.raw`srcset|data-srcset|imagesrcset|data-original|data-src|xlink:href|poster|action|href|src`;
const SRCSET_ATTR = new Set(['srcset', 'data-srcset', 'imagesrcset']);

interface RewriteContext {
  root: URL;
  placeholder: boolean;
  token?: string;
  assetExists?: (pathname: string) => boolean;
}

/** Extensions the stand may serve from the archive in place of an external URL. */
const ARCHIVED_ASSET = /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm)$/i;

export function rewriteHtmlAssets(html: string, options: AssetRewriteOptions): string {
  const ctx = contextOf(options.assetRoot, options.previewToken, options.assetExists);
  const base = resolveBase(options.pageUrl, ctx);
  let out = html.replace(
    new RegExp(String.raw`(\s(?:${URL_ATTR})\s*=\s*)(['"])([^'"]*)\2`, 'gi'),
    (match, prefix: string, quote: string, value: string) => {
      const name = attrName(prefix);
      const rewritten = SRCSET_ATTR.has(name) ? rewriteSrcset(value, ctx, base) : rewriteOne(value, ctx, base);
      if (rewritten === value) return match;
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_match, open: string, css: string, close: string) => {
    return `${open}${rewriteCss(css, ctx, base)}${close}`;
  });
  out = out.replace(/(\sstyle\s*=\s*)(['"])([\s\S]*?)\2/gi, (match, prefix: string, quote: string, css: string) => {
    const rewritten = rewriteCss(css, ctx, base);
    if (rewritten === css) return match;
    return `${prefix}${quote}${rewritten}${quote}`;
  });
  return rewriteBaseTags(out, ctx);
}

/** `{{cdn}}` must already be expanded. Relative url() resolve against pageUrl (the stylesheet). */
export function rewriteCssAssets(css: string, options: AssetRewriteOptions): string {
  const ctx = contextOf(options.assetRoot, options.previewToken, options.assetExists);
  return rewriteCss(css, ctx, resolveBase(options.pageUrl, ctx));
}

/** Adds the preview token to absolute stand URLs produced by `{{cdn}}` inside JS. The bare CDN base is left intact. */
export function stampCdnUrls(source: string, assetRoot: string, previewToken?: string): string {
  if (!previewToken) return source;
  const ctx = contextOf(assetRoot, previewToken);
  const rootHref = (ctx.placeholder ? ctx.root.pathname : ctx.root.href).replace(/\/$/, '');
  if (!rootHref) return source;
  const re = new RegExp(`${escapeRegExp(rootHref)}\\/[^\\s"'\`()<>\\\\,;]+`, 'g');
  return source.replace(re, (match) => appendToken(match, previewToken));
}

function rewriteCss(css: string, ctx: RewriteContext, base: URL): string {
  let out = css.replace(/url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"\s][^)]*?))\s*\)/gi, (match, single?: string, double?: string, bare?: string) => {
    const value = (single ?? double ?? bare ?? '').trim();
    const quote = single != null ? "'" : double != null ? '"' : '';
    const rewritten = rewriteOne(value, ctx, base);
    if (rewritten === value) return match;
    if (!quote && /[\s)]/.test(rewritten)) return `url("${rewritten}")`;
    return quote ? `url(${quote}${rewritten}${quote})` : `url(${rewritten})`;
  });
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, value: string) => {
    const rewritten = rewriteOne(value.trim(), ctx, base);
    if (rewritten === value.trim()) return match;
    return `@import ${quote}${rewritten}${quote}`;
  });
  return out;
}

function rewriteSrcset(value: string, ctx: RewriteContext, base: URL): string {
  return value
    .split(',')
    .map((part) => {
      const core = part.trim();
      if (!core) return part;
      const space = core.search(/\s/);
      const url = space === -1 ? core : core.slice(0, space);
      const desc = space === -1 ? '' : core.slice(space);
      const leading = part.match(/^\s*/)?.[0] ?? '';
      return `${leading}${rewriteOne(url, ctx, base)}${desc}`;
    })
    .join(',');
}

function rewriteBaseTags(html: string, ctx: RewriteContext): string {
  const href = escapeAttr(rootHref(ctx));
  const tag = `<base href="${href}">`;
  if (/<base\b/i.test(html)) return html.replace(/<base\b[^>]*>/gi, tag);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`);
  return `${tag}${html}`;
}

function rewriteOne(value: string, ctx: RewriteContext, base: URL): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) return value;
  if (/^(?:data|blob|mailto|javascript|tel):/i.test(trimmed)) return value;
  try {
    if (trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      const absolute = trimmed.startsWith('//') ? new URL(`${base.protocol}${trimmed}`) : new URL(trimmed);
      if (sameAsset(absolute, ctx)) return appendToken(emit(absolute, ctx), ctx.token);
      return mapArchivedAsset(absolute, ctx) ?? value;
    }
    if (trimmed.startsWith('/')) {
      const rootPath = ctx.root.pathname.replace(/\/$/, '');
      const pathOnly = trimmed.split(/[?#]/)[0];
      const already = rootPath && (pathOnly === rootPath || pathOnly.startsWith(`${rootPath}/`));
      const absolute = already ? new URL(trimmed, ctx.root.origin) : new URL(trimmed.replace(/^\/+/, ''), ctx.root);
      return appendToken(emit(absolute, ctx), ctx.token);
    }
    const relative = new URL(trimmed, base);
    if (!sameAsset(relative, ctx)) return value;
    return appendToken(emit(relative, ctx), ctx.token);
  } catch {
    return value;
  }
}

/** Point an external URL at the stand only when that exact archive path exists. Never fetches the publisher. */
function mapArchivedAsset(url: URL, ctx: RewriteContext): string | null {
  if (!ctx.assetExists || !ARCHIVED_ASSET.test(url.pathname)) return null;
  let exists = false;
  try {
    exists = ctx.assetExists(url.pathname);
  } catch {
    return null;
  }
  if (!exists) return null;
  const local = new URL(`${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`, ctx.root);
  return appendToken(emit(local, ctx), ctx.token);
}

function contextOf(assetRoot: string, token?: string, assetExists?: (pathname: string) => boolean): RewriteContext {
  const trimmed = assetRoot.trim().replace(/\/$/, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return { root: new URL(`${trimmed}/`), placeholder: false, token, assetExists };
  }
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return { root: new URL(`${path}/`, PLACEHOLDER_ORIGIN), placeholder: true, token, assetExists };
}

function resolveBase(pageUrl: string | undefined, ctx: RewriteContext): URL {
  if (!pageUrl) return ctx.root;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(pageUrl)) return new URL(pageUrl);
    const path = pageUrl.startsWith('/') ? pageUrl : `/${pageUrl}`;
    return new URL(path, ctx.root.origin);
  } catch {
    return ctx.root;
  }
}

function sameAsset(url: URL, ctx: RewriteContext): boolean {
  if (url.origin !== ctx.root.origin) return false;
  const rootPath = ctx.root.pathname.replace(/\/$/, '');
  if (!rootPath) return true;
  return url.pathname === rootPath || url.pathname.startsWith(`${rootPath}/`);
}

function emit(url: URL, ctx: RewriteContext): string {
  if (!ctx.placeholder) return url.href;
  return `${url.pathname}${url.search}${url.hash}`;
}

function rootHref(ctx: RewriteContext): string {
  if (!ctx.placeholder) return ctx.root.href;
  return ctx.root.pathname;
}

function appendToken(url: string, token: string | undefined): string {
  if (!token) return url;
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const before = hashAt >= 0 ? url.slice(0, hashAt) : url;
  if (/(?:^|[?&])t=/.test(before)) return url;
  const join = before.includes('?') ? '&' : '?';
  return `${before}${join}t=${encodeURIComponent(token)}${hash}`;
}

function attrName(prefix: string): string {
  return prefix.replace(/^\s+/, '').replace(/\s*=\s*$/, '').toLowerCase();
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isolate(html: string): string {
  let out = html.replace(/<script\b[^>]*\bsrc\s*=\s*(['"])(?:https?:)?\/\/[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<form\b([^>]*)>/gi, (_match, attrs: string) => {
    const cleaned = attrs
      .replace(/\saction\s*=\s*(['"]).*?\1/gi, '')
      .replace(/\sonsubmit\s*=\s*(['"]).*?\1/gi, '');
    return `<form${cleaned} data-stand-isolated="1" onsubmit="return false">`;
  });
  return out;
}

/** Stand origin is listed beside 'self' so a sandboxed iframe (opaque origin) can still load this preview's CSS, images and fonts. */
export function isolatedCsp(assetOrigin: string): string {
  const extra = assetOrigin ? ` ${assetOrigin}` : '';
  return [
    `default-src 'self'${extra}`,
    "script-src 'self' 'unsafe-inline'",
    `style-src 'self' 'unsafe-inline'${extra}`,
    `img-src 'self' data:${extra}`,
    `font-src 'self' data:${extra}`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    `base-uri 'self'${extra}`,
  ].join('; ');
}

export function liveCsp(frameAncestors: string[]): string {
  const ancestors =
    frameAncestors.length > 0 ? frameAncestors.join(' ') : 'http://localhost:4200 http://127.0.0.1:4200';
  return [
    "default-src 'self' https: data: blob:",
    "script-src 'self' 'unsafe-inline' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "connect-src https:",
    "form-action https:",
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}
