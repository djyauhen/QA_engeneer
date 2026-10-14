export function transformHtml(
  html: string,
  options: { formHtml: string; brandName: string; cdnBase: string; isolated: boolean },
): string {
  let out = html.split('{{form}}').join(options.formHtml);
  out = out.split('{{aio.visit.fields.offer_name.for_visitors}}').join(options.brandName);
  out = out.split('{{cdn}}').join(options.cdnBase);
  const injection = `<script>window.__CDN_BASE__=${JSON.stringify(options.cdnBase)};</script>`;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (match) => `${match}${injection}`);
  else out = injection + out;
  if (options.isolated) out = isolate(out);
  return out;
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

export const ISOLATED_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

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
    "base-uri 'none'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}
