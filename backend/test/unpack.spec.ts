import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { MAX_DOWNLOAD_BYTES, MAX_UNPACK_BYTES, MAX_UNPACK_ENTRIES } from '../src/aio/aio.client';
import { UNPACK_TOO_LARGE, unpackZip } from '../src/files/unpack';

describe('unpack limits', () => {
  it('keeps the download cap and a larger finite unpack cap', () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(80 * 1024 * 1024);
    expect(MAX_UNPACK_BYTES).toBe(512 * 1024 * 1024);
    expect(MAX_UNPACK_ENTRIES).toBe(5000);
    expect(MAX_UNPACK_BYTES).toBeGreaterThan(MAX_DOWNLOAD_BYTES);
  });

  it('unpacks a small landing and refuses an archive that is too big or too wide', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-unpack-'));
    try {
      const ok = unpackZip(zipOf({ 'landing/index.html': '<p>ok</p>' }), dir);
      expect(fs.existsSync(path.join(ok.landingFolder, 'index.html'))).toBe(true);

      const wide = zipOf({ 'a.txt': 'a', 'b.txt': 'b' });
      expect(() => unpackZip(wide, dir, { maxEntries: 1 })).toThrow(UNPACK_TOO_LARGE);
      expect(fs.existsSync(path.join(dir, 'raw', 'a.txt'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'raw', 'b.txt'))).toBe(false);

      const heavy = zipOf({ 'landing/index.html': 'hello' });
      expect(() => unpackZip(heavy, dir, { maxBytes: 4 })).toThrow(UNPACK_TOO_LARGE);
      expect(fs.existsSync(path.join(dir, 'raw', 'landing', 'index.html'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function zipOf(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  return zip.toBuffer();
}
