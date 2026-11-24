import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildAiMaterials, MAX_PAGE_TEXT_CHARS } from '../src/ai/materials';
import { attachmentLabels } from '../src/ai/qa-categories';
import { QA_INSTRUCTION } from '../src/ai/qa-instruction';
import { enforceCommentAvatars, enforceImageCorrespondence, mapQaResponse, stripOverallLine } from '../src/ai/qa-response';

function jpeg(size: number, seed: number): Buffer {
  const buf = Buffer.alloc(size, seed);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

describe('buildAiMaterials', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-materials-'));
    fs.mkdirSync(path.join(dir, 'images'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, data: string | Buffer): void {
    fs.writeFileSync(path.join(dir, rel), data);
  }

  const heroPage = `<html><head><title>Hidden title</title><style>.x{color:red}</style></head><body>
<script>var secret = "SCRIPT_BODY";</script>
<h1>Andrzej Duda &amp; Mifix: new platform</h1>
<p>Andrzej Duda said &quot;it works&quot;&nbsp;today &lt;really&gt; it&#39;s true.</p>
<img src="images/hero.jpg" alt="photo">
<svg><text>SVG_TEXT</text></svg>
</body></html>`;

  it('resolves the person from the land name and page text and sends the hero with claims_person (no name in alt)', () => {
    write('index.html', heroPage);
    write('images/hero.jpg', jpeg(5000, 1));
    const result = buildAiMaterials(dir, 'PL_Andrzej_Duda_Mifix', '2026-10-26');
    expect(result.person).toEqual({
      from_land_name: 'Andrzej Duda',
      from_page_text: 'Andrzej Duda',
      resolved: 'Andrzej Duda',
      conflict: false,
    });
    expect(result.indexFile).toBe('index.html');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      ref: 'I1',
      file: 'images/hero.jpg',
      alt: 'photo',
      kind: 'content',
      claims_person: 'Andrzej Duda',
      mime: 'image/jpeg',
    });
    expect(result.images[0].buffer.length).toBe(5000);
    expect(result.images[0].context).toContain('Andrzej Duda');
  });

  it('extracts visible text only: no script, style, svg, head; entities decoded', () => {
    write('index.html', heroPage);
    const { pageText, textTruncated } = buildAiMaterials(dir, 'PL_Andrzej_Duda_Mifix', '2026-10-26');
    expect(textTruncated).toBe(false);
    expect(pageText).not.toContain('SCRIPT_BODY');
    expect(pageText).not.toContain('color:red');
    expect(pageText).not.toContain('SVG_TEXT');
    expect(pageText).not.toContain('Hidden title');
    expect(pageText).toContain('Andrzej Duda & Mifix: new platform');
    expect(pageText).toContain('said "it works" today <really> it\'s true.');
  });

  it('uses index.php when index.html is missing and ignores css/js files', () => {
    write('index.php', '<?php echo 1; ?><h1>Jan Kowalski</h1><p>text</p>');
    write('style.css', 'body{content:"CSS_BODY"}');
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.indexFile).toBe('index.php');
    expect(result.pageText).toBe('Jan Kowalski text');
    expect(result.pageText).not.toContain('CSS_BODY');
    expect(result.person.resolved).toBe('Jan Kowalski');
    expect(result.person.from_land_name).toBeNull();
  });

  it('caps the page text and reports truncation', () => {
    write('index.html', `<p>${'a '.repeat(MAX_PAGE_TEXT_CHARS)}</p>`);
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.textTruncated).toBe(true);
    expect(result.pageText.length).toBe(MAX_PAGE_TEXT_CHARS);
  });

  it('skips external, data, svg, traversal, tiny, oversize and logo-like images; resolves a {{cdn}} macro', () => {
    write(
      'index.html',
      `<h1>Andrzej Duda</h1>
<img src="https://cdn.example.com/a.jpg">
<img src="//cdn.example.com/b.jpg">
<img src="data:image/jpeg;base64,AAAA">
<img src="images/vector.svg">
<img src="../outside.jpg">
<img src="images/tiny.jpg">
<img src="images/big.jpg">
<img src="images/logo.jpg">
<img src="images/favicon.png">
<img src="{{cdn}}/images/hero.jpg?v=3#x" alt="">`,
    );
    write('images/vector.svg', '<svg>' + 'x'.repeat(3000) + '</svg>');
    fs.writeFileSync(path.join(path.dirname(dir), 'outside.jpg'), jpeg(5000, 9));
    write('images/tiny.jpg', jpeg(500, 2));
    write('images/big.jpg', jpeg(350_001, 3));
    write('images/logo.jpg', jpeg(5000, 4));
    write('images/favicon.png', jpeg(5000, 5));
    write('images/hero.jpg', jpeg(5000, 6));
    try {
      const result = buildAiMaterials(dir, 'Andrzej Duda', '2026-10-26');
      expect(result.images.map((image) => image.file)).toEqual(['images/hero.jpg']);
    } finally {
      fs.rmSync(path.join(path.dirname(dir), 'outside.jpg'), { force: true });
    }
  });

  it('resolves {{cdn}}image paths without a slash, and still resolves one other leading macro', () => {
    write('index.html', '<img src="{{cdn}}images/hero.jpg" alt=""><img src="{{shot}}/images/side.jpg" alt="">');
    write('images/hero.jpg', jpeg(5000, 6));
    write('images/side.jpg', jpeg(5000, 7));
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.images.map((image) => image.file)).toEqual(['images/hero.jpg', 'images/side.jpg']);
  });

  it('parses data-src and the first srcset URL', () => {
    write(
      'index.html',
      `<img data-src="images/a.jpg"><img srcset="images/b.jpg 1x, images/c.jpg 2x">`,
    );
    write('images/a.jpg', jpeg(3000, 1));
    write('images/b.jpg', jpeg(3000, 2));
    write('images/c.jpg', jpeg(3000, 3));
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.images.map((image) => image.file)).toEqual(['images/a.jpg', 'images/b.jpg']);
  });

  it('keeps a duplicated image (same sha256) only once', () => {
    write('index.html', '<img src="images/a.jpg"><img src="images/b.jpg"><img src="images/c.jpg">');
    write('images/a.jpg', jpeg(3000, 7));
    write('images/b.jpg', jpeg(3000, 7));
    write('images/c.jpg', jpeg(3000, 8));
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.images.map((image) => image.file)).toEqual(['images/a.jpg', 'images/c.jpg']);
  });

  it('orders name-matching content first, then hero-first content, then comment avatars; caps at 8', () => {
    const filler = `<p>${'filler '.repeat(30)}</p>`;
    const imgs: string[] = [filler];
    imgs.push('<figure><img src="images/c1.jpg" alt="crowd"><figcaption>Street crowd</figcaption></figure>');
    imgs.push(filler);
    imgs.push('<p>Here Andrzej Duda speaks</p><img src="images/c2.jpg" alt="speaker">');
    imgs.push('<div class="comments-list"><div class="comment"><img src="images/av1.jpg" alt="Anna Nowak"><p>Great</p></div></div>');
    for (let i = 3; i <= 10; i += 1) imgs.push(`${filler}<img src="images/c${i}.jpg" alt="x">`);
    write('index.html', `<h1>Andrzej Duda</h1>${imgs.join('\n')}`);
    for (let i = 1; i <= 10; i += 1) write(`images/c${i}.jpg`, jpeg(3000, 20 + i));
    write('images/av1.jpg', jpeg(3000, 99));
    const result = buildAiMaterials(dir, 'PL_Andrzej_Duda', '2026-10-26');
    expect(result.images).toHaveLength(8);
    expect(result.images.map((image) => image.ref)).toEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8']);
    expect(result.images[0].file).toBe('images/c2.jpg');
    expect(result.images[1].file).toBe('images/c1.jpg');
    expect(result.images[1].caption).toBe('Street crowd');
    expect(result.images.every((image) => image.kind === 'content')).toBe(true);
    expect(result.images.filter((image) => image.claims_person).map((image) => image.file)).toEqual(['images/c2.jpg']);
    expect(result.images.every((image) => image.proof === false)).toBe(true);
  });

  it('orders content, then proof screenshots, then avatars', () => {
    write(
      'index.html',
      `<h1>Andrzej Duda</h1>
      <img src="images/hero.jpg" alt="Andrzej Duda">
      <div class="comments">
        <div class="comment">
          <img src="images/ava.jpg" alt="">
          <div class="name">Anna Nowak</div>
          <p>Llego el ingreso.</p>
          <img src="images/shot.jpg" alt="">
        </div>
      </div>`,
    );
    write('images/hero.jpg', jpeg(3000, 11));
    write('images/ava.jpg', jpeg(3000, 12));
    write('images/shot.jpg', jpeg(3000, 13));
    const result = buildAiMaterials(dir, 'PL_Andrzej_Duda', '2026-10-26');
    expect(result.images.map((image) => [image.file, image.kind, image.proof])).toEqual([
      ['images/hero.jpg', 'content', false],
      ['images/shot.jpg', 'comment', true],
      ['images/ava.jpg', 'comment', false],
    ]);
    expect(result.commentAvatars.map((avatar) => avatar.name)).toEqual(['Anna Nowak']);
  });

  it('keeps in-comment proof screenshots ahead of avatars inside the cap of 8', () => {
    const content = Array.from({ length: 7 }, (_, index) => `<p>${'word '.repeat(20)}</p><img src="images/c${index}.jpg" alt="">`).join('');
    const row = (name: string, avatar: string, shot: string | null): string => `<div class="_3-8y">
      <div class="_ohe"><a class="UFIImageBlockImage"><img src="images/${avatar}" alt=""></a></div>
      <div class="UFIImageBlockContent">
        <a class="UFICommentActorName">${name}</a>
        <div class="_3-8m">Texto de ${name}.</div>
        ${shot ? `<div class="image"><img src="images/${shot}" alt=""></div>` : ''}
      </div>
    </div>`;
    const comments = [
      row('Maria Jimenez', 'a0.jpg', 's0.jpg'),
      row('Esther Marchetti', 'a1.jpg', 's1.jpg'),
      row('Jose Camorra', 'a2.jpg', null),
      row('Carlos Ruiz', 'a3.jpg', null),
      row('Ana Lopez', 'a4.jpg', null),
      row('Luis Perez', 'a5.jpg', null),
    ].join('');
    write('index.html', `<h1>Andrzej Duda</h1>${content}<div class="comments"><div id="comments_form"></div>${comments}</div>`);
    for (let index = 0; index < 7; index += 1) write(`images/c${index}.jpg`, jpeg(3000, 30 + index));
    for (let index = 0; index < 6; index += 1) write(`images/a${index}.jpg`, jpeg(3000, 40 + index));
    write('images/s0.jpg', jpeg(3000, 50));
    write('images/s1.jpg', jpeg(3000, 51));
    const result = buildAiMaterials(dir, 'PL_Andrzej_Duda', '2026-10-26');
    expect(result.images).toHaveLength(8);
    const files = result.images.map((image) => image.file);
    expect(files).toContain('images/s0.jpg');
    expect(files).toContain('images/s1.jpg');
    expect(files.filter((file) => file.startsWith('images/a'))).toEqual([]);
    expect(files.indexOf('images/s0.jpg')).toBeGreaterThan(files.lastIndexOf('images/c0.jpg'));
    expect(files.indexOf('images/s1.jpg')).toBeGreaterThan(files.indexOf('images/s0.jpg'));
    expect(result.images.find((image) => image.file === 'images/s0.jpg')).toMatchObject({
      kind: 'comment',
      proof: true,
      claims_person: null,
    });
    expect(result.images.find((image) => image.file === 'images/s1.jpg')).toMatchObject({ kind: 'comment', proof: true });
    expect(result.commentAvatars.map((avatar) => avatar.name)).toEqual([
      'Maria Jimenez',
      'Esther Marchetti',
      'Jose Camorra',
      'Carlos Ruiz',
      'Ana Lopez',
      'Luis Perez',
    ]);
  });

  it('marks comment avatars and leaves claims_person null on every avatar', () => {
    write(
      'index.html',
      `<h1>Andrzej Duda</h1><img src="images/hero.jpg" alt="">
<p>${'filler '.repeat(30)}</p>
<div class="comment-item"><img src="images/av1.jpg" alt="Anna"><span>Nice</span></div>
<div id="comment-2"><img src="images/av2.jpg" alt="Fan of Andrzej Duda"></div>`,
    );
    write('images/hero.jpg', jpeg(3000, 1));
    write('images/av1.jpg', jpeg(3000, 2));
    write('images/av2.jpg', jpeg(3000, 3));
    const result = buildAiMaterials(dir, 'PL_Andrzej_Duda', '2026-10-26');
    expect(result.images.map((image) => [image.file, image.kind, image.claims_person])).toEqual([
      ['images/hero.jpg', 'content', 'Andrzej Duda'],
      ['images/av1.jpg', 'comment', null],
      ['images/av2.jpg', 'comment', null],
    ]);
  });

  it('claims the first content frame when the name is farther than 90 characters and the alt is empty', () => {
    const gap = 'word '.repeat(40);
    write(
      'index.html',
      `<h1>Georges Karam</h1><p>${gap}</p><img src="images/person.jpg" alt="">
<div class="comments"><div class="comment"><img src="images/avatar.jpg" alt="Georges Karam"></div></div>`,
    );
    write('images/person.jpg', jpeg(3000, 1));
    write('images/avatar.jpg', jpeg(3000, 2));
    const result = buildAiMaterials(dir, 'FR_Georges_Karam', '2026-10-26');
    expect(result.person).toMatchObject({ from_land_name: 'Georges Karam', resolved: 'Georges Karam' });
    const hero = result.images.find((image) => image.claims_person);
    expect(hero).toMatchObject({
      file: 'images/person.jpg',
      alt: '',
      kind: 'content',
      claims_person: 'Georges Karam',
    });
    expect(hero?.context.toLowerCase()).not.toContain('georges');
    expect(result.images.filter((image) => image.kind === 'comment').map((image) => image.claims_person)).toEqual([null]);
    const content = result.images.filter((image) => image.kind === 'content').map((image) => image.ref);
    const comment = result.images.filter((image) => image.kind === 'comment').map((image) => image.ref);
    const heroRef = result.images.find((image) => image.kind !== 'comment' && image.claims_person)?.ref ?? null;
    expect(attachmentLabels(3, [...content, ...comment], { content, comment, hero: heroRef })).toEqual([heroRef]);
  });

  it('does not make a comment frame the hero when it is the only picture', () => {
    write(
      'index.html',
      `<h1>Georges Karam</h1><div class="comments"><div class="comment"><img src="images/avatar.jpg" alt="Georges Karam"></div></div>`,
    );
    write('images/avatar.jpg', jpeg(3000, 2));
    const result = buildAiMaterials(dir, 'FR_Georges_Karam', '2026-10-26');
    expect(result.images.map((image) => [image.kind, image.claims_person])).toEqual([['comment', null]]);
    const comment = result.images.map((image) => image.ref);
    expect(attachmentLabels(3, comment, { content: [], comment, hero: null })).toEqual([]);
  });

  it('treats a hyphen and a space as the same name separator and still prefers the nearby frame', () => {
    const gap = 'word '.repeat(40);
    write(
      'index.html',
      `<h1>Georges Karam</h1><p>${gap}</p><img src="images/far.jpg" alt=""><p>${gap}</p><img src="images/near.jpg" alt="Georges-Karam">`,
    );
    write('images/far.jpg', jpeg(3000, 1));
    write('images/near.jpg', jpeg(3000, 2));
    const hyphenInAlt = buildAiMaterials(dir, 'FR_Georges_Karam', '2026-10-26');
    expect(hyphenInAlt.person.resolved).toBe('Georges Karam');
    expect(hyphenInAlt.images.filter((image) => image.claims_person).map((image) => image.file)).toEqual(['images/near.jpg']);

    write(
      'index.html',
      `<h1>Georges Karam</h1><p>${gap}</p><img src="images/far.jpg" alt=""><p>${gap}</p><p>Georges Karam speaks</p><img src="images/near.jpg" alt="">`,
    );
    const spacedBeside = buildAiMaterials(dir, 'Georges-Karam', '2026-10-26');
    expect(spacedBeside.person.resolved).toBe('Georges-Karam');
    expect(spacedBeside.images.filter((image) => image.claims_person).map((image) => image.file)).toEqual(['images/near.jpg']);
    expect(spacedBeside.images.find((image) => image.file === 'images/near.jpg')?.context).toContain('Georges Karam');
  });

  it('does not invent a person: claims_person stays null and resolved is null', () => {
    write('index.html', '<p>lower case text only</p><img src="images/hero.jpg">');
    write('images/hero.jpg', jpeg(3000, 1));
    const result = buildAiMaterials(dir, 'landing_123', '2026-10-26');
    expect(result.person).toEqual({ from_land_name: null, from_page_text: null, resolved: null, conflict: false });
    expect(result.images[0].claims_person).toBeNull();
  });

  it('prefers the land name and flags a conflict with the page person', () => {
    write('index.html', '<h1>Donald Tusk speaks</h1><p>text</p>');
    const result = buildAiMaterials(dir, 'PL|Andrzej_Duda', '2026-10-26');
    expect(result.person.resolved).toBe('Andrzej Duda');
    expect(result.person.from_page_text).toBe('Donald Tusk');
    expect(result.person.conflict).toBe(true);
  });

  it('keeps a pipe-separated outlet out of the person and does not conflict with the same name later on the page', () => {
    write('index.html', '<h1>Index Zid Vijesti Sport</h1><p>Josip Kelemen o novom prijedlogu.</p>');
    const result = buildAiMaterials(dir, 'HR|VI|Templ1|Index|Josip Kelemen|250$', '2026-10-26');
    expect(result.pageText.startsWith('Index Zid Vijesti Sport')).toBe(true);
    expect(result.pageText).toContain('Josip Kelemen');
    expect(result.person).toEqual({
      from_land_name: 'Josip Kelemen',
      from_page_text: 'Josip Kelemen',
      resolved: 'Josip Kelemen',
      conflict: false,
    });
  });

  it('flags a different h1 person when the pipe-separated land name is absent from the page', () => {
    write('index.html', '<h1>Donald Tusk speaks</h1><p>Index Zid Vijesti Sport</p>');
    const result = buildAiMaterials(dir, 'HR|VI|Templ1|Index|Josip Kelemen|250$', '2026-10-26');
    expect(result.pageText).not.toContain('Josip Kelemen');
    expect(result.person.from_land_name).toBe('Josip Kelemen');
    expect(result.person.resolved).toBe('Josip Kelemen');
    expect(result.person.conflict).toBe(true);
    expect(result.person.from_page_text).toBe('Donald Tusk');
    expect(result.person.from_page_text).not.toBe('Index Josip Kelemen');
    expect(result.person.from_page_text?.startsWith('Index')).toBe(false);
  });

  it('cuts an outlet tail off the land title and does not take a four-word menu as the page person', () => {
    write(
      'index.html',
      '<h1>Nouvelles Vidéos Chroniques Régions</h1><p>La chronique décrit un placement au Québec.</p>',
    );
    const result = buildAiMaterials(dir, 'Charles-Emond Noovo-Info', '2026-10-26');
    expect(result.person).toEqual({
      from_land_name: 'Charles-Emond',
      from_page_text: null,
      resolved: 'Charles-Emond',
      conflict: false,
    });
  });

  it('does not turn a four-word capitalized menu into the page person when the land names nobody', () => {
    write('index.html', '<h1>Nouvelles Vidéos Chroniques Régions</h1><p>texte</p>');
    const result = buildAiMaterials(dir, 'demo', '2026-10-26');
    expect(result.person.from_page_text).toBeNull();
    expect(result.person.resolved).toBeNull();
    expect(result.person.conflict).toBe(false);
  });

  it('drops a catalog outlet glued after the person in the land title', () => {
    write('index.html', '<p>texte</p>');
    const result = buildAiMaterials(dir, 'Charles-Emond Le Monde', '2026-10-26');
    expect(result.person.from_land_name).toBe('Charles-Emond');
    expect(result.person.resolved).toBe('Charles-Emond');
    expect(result.person.conflict).toBe(false);
  });

  it('falls back to the page text person when the land name has none', () => {
    write('index.html', '<h1>lead</h1><p>Interview with Maria Skłodowska today</p>');
    const result = buildAiMaterials(dir, 'demo', '2026-10-26');
    expect(result.person.resolved).toBe('Maria Skłodowska');
    expect(result.person.from_land_name).toBeNull();
    expect(result.person.conflict).toBe(false);
  });

  it('returns empty materials without an index file', () => {
    const result = buildAiMaterials(dir, 'PL_Andrzej_Duda', '2026-10-26');
    expect(result.pageText).toBe('');
    expect(result.images).toEqual([]);
    expect(result.person.resolved).toBe('Andrzej Duda');
  });

  it('reads a trailing initial as the commenter and ignores the French reply control', () => {
    write(
      'index.html',
      `<div class="comments">
  <div class="comment">
    <img src="images/a1.jpg" alt="">
    <div class="name">Stéphane M.</div>
    <p>J'ai commencé avec 205 CHF.</p>
    <div class="actions"><span>J'aime</span> <a href="#">Répondre</a></div>
  </div>
  <div class="comment">
    <img src="images/a2.jpg" alt="">
    <strong class="author">Hans K.</strong>
    <p>Je suis retraité.</p>
    <button type="button">Répondre</button>
  </div>
</div>`,
    );
    write('images/a1.jpg', jpeg(3000, 11));
    write('images/a2.jpg', jpeg(3000, 12));
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.commentAvatars.map((avatar) => avatar.name)).toEqual(['Stéphane M.', 'Hans K.']);
  });

  it('does not invent a commenter from a reply button', () => {
    write(
      'index.html',
      `<div class="comment">
  <img src="images/a1.jpg" alt="">
  <p>merci pour le retour.</p>
  <a href="#">Répondre</a>
</div>`,
    );
    write('images/a1.jpg', jpeg(3000, 13));
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.commentAvatars).toEqual([]);
  });

  it('keeps full names and Jaime, and drops reply labels, J\'aime, and a lone initial', () => {
    const accepted: Array<[string, string]> = [
      ['Anna Nowak', 'anna'],
      ['Andrzej Duda', 'andrzej'],
      ['Jean-Pierre D.', 'pierre'],
      ['Stéphane M', 'stephane'],
      ['Jaime', 'jaime'],
    ];
    const rejected = [
      'M.',
      'M',
      "J'aime",
      'Reply',
      'Replies',
      'Répondre',
      'Antworten',
      'Antwort',
      'Responder',
      'Responde',
      'Rispondi',
      'Ответить',
      'Yanıtla',
      'Antwoord',
      'Svara',
      'Partager',
      'Like',
      'Share',
    ];
    const parts: string[] = [];
    accepted.forEach(([name, file], index) => {
      write(`images/${file}.jpg`, jpeg(3000, 30 + index));
      parts.push(
        `<div class="comment"><img src="images/${file}.jpg" alt=""><a class="name" href="#">${name}</a><button type="button">Répondre</button></div>`,
      );
    });
    rejected.forEach((label, index) => {
      const file = `skip${index}`;
      write(`images/${file}.jpg`, jpeg(3000, 50 + index));
      parts.push(
        `<div class="comment"><img src="images/${file}.jpg" alt=""><div class="name">${label}</div><a href="#">Répondre</a></div>`,
      );
    });
    write('index.html', `<div class="comments">${parts.join('')}</div>`);
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.commentAvatars.map((avatar) => avatar.name)).toEqual(accepted.map(([name]) => name));
  });

  it('does not turn article figures inside preview or a wide reviews block into comment avatars', () => {
    const banner = jpeg(3000, 21);
    const selfie = jpeg(3000, 22);
    const watch = jpeg(3000, 23);
    const banks = jpeg(3000, 24);
    const loose = jpeg(3000, 25);
    const marco = jpeg(3000, 26);
    const luca = jpeg(3000, 27);
    write('images/banner.jpg', banner);
    write('images/selfie.jpg', selfie);
    write('images/watch.jpg', watch);
    write('images/banks.jpg', banks);
    write('images/loose.jpg', loose);
    write('images/marco.jpg', marco);
    write('images/luca.jpg', luca);
    write(
      'index.html',
      `<div class="preview">
  <div class="preview">
    <figure>
      <img src="images/banner.jpg" alt="">
      <figcaption class="author">Sigfrido Ranucci</figcaption>
    </figure>
  </div>
  <div class="preview">
    <figure>
      <img src="images/selfie.jpg" alt="">
      <figcaption class="author">Maria Ferrari</figcaption>
    </figure>
  </div>
  <div class="preview">
    <figure>
      <img src="images/watch.jpg" alt="">
      <figcaption class="name">Giuseppe Camorra</figcaption>
    </figure>
  </div>
  <div id="otzyv" class="feedback">
    <div class="reviews">
      <figure>
        <img src="images/banks.jpg" alt="">
        <figcaption class="name">Marco Rossi</figcaption>
      </figure>
      <div class="comments">
        <img src="images/loose.jpg" alt="">
        <p class="author">Sigfrido Ranucci</p>
        <div class="comment">
          <img src="images/marco.jpg" alt="">
          <div class="name">Marco Rossi</div>
          <p>Ho provato la piattaforma.</p>
        </div>
        <div class="review">
          <img src="images/luca.jpg" alt="">
          <span class="author">Luca Bianchi</span>
          <p>Confermo.</p>
        </div>
      </div>
    </div>
  </div>
</div>`,
    );
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    const photoKey = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
    expect(result.commentAvatars.map((avatar) => avatar.name)).toEqual(['Marco Rossi', 'Luca Bianchi']);
    expect(result.commentAvatars.map((avatar) => avatar.photoKey)).toEqual([photoKey(marco), photoKey(luca)]);
    expect(result.commentAvatars.map((avatar) => avatar.photoKey)).not.toContain(photoKey(banks));
    for (const file of ['images/banner.jpg', 'images/selfie.jpg', 'images/watch.jpg', 'images/banks.jpg', 'images/loose.jpg']) {
      expect(result.images.find((image) => image.file === file)?.kind).toBe('content');
    }
    expect(result.images.find((image) => image.file === 'images/marco.jpg')?.kind).toBe('comment');
    expect(result.images.find((image) => image.file === 'images/luca.jpg')?.kind).toBe('comment');
    const enforced = enforceCommentAvatars(
      { findings: [], report: { checks: [{ category: 9, status: 'PASS' }] } },
      { pageText: result.pageText, avatars: result.commentAvatars },
    );
    expect(enforced.findings.map((finding) => finding.problem ?? '')).toEqual([]);
    expect(enforced.report?.checks?.find((check) => check.category === 9)?.status).toBe('PASS');
  });

  it('flags one commenter with two different comment avatars', () => {
    const first = jpeg(3000, 41);
    const second = jpeg(3000, 42);
    write('images/m1.jpg', first);
    write('images/m2.jpg', second);
    write(
      'index.html',
      `<div class="comments">
  <div class="comment">
    <img src="images/m1.jpg" alt="">
    <div class="name">Marco Rossi</div>
    <p>Primo commento.</p>
  </div>
  <div class="comment">
    <img src="images/m2.jpg" alt="">
    <div class="name">Marco Rossi</div>
    <p>Secondo commento.</p>
  </div>
</div>`,
    );
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    expect(result.commentAvatars.map((avatar) => avatar.name)).toEqual(['Marco Rossi', 'Marco Rossi']);
    expect(new Set(result.commentAvatars.map((avatar) => avatar.photoKey)).size).toBe(2);
    const enforced = enforceCommentAvatars(
      { findings: [], report: { checks: [{ category: 9, status: 'PASS' }] } },
      { pageText: result.pageText, avatars: result.commentAvatars },
    );
    expect(enforced.findings).toEqual([
      expect.objectContaining({
        file: 'index.html',
        category: 9,
        priority: 'major',
        where: 'Комментарии «Marco Rossi»',
        problem: 'У комментатора «Marco Rossi» разные фото.',
        expected: 'У одного имени одно фото.',
        screenshot: result.commentAvatars[0].screenshot,
      }),
    ]);
    expect(enforced.report?.checks).toEqual([
      { category: 9, status: 'FAIL', note: 'У комментатора «Marco Rossi» разные фото' },
    ]);
  });

  it('keeps the avatar next to the name and ignores an image attached inside the comment', () => {
    const avatar = jpeg(3000, 61);
    const banks = jpeg(3000, 62);
    const selfie = jpeg(3000, 63);
    const watch = jpeg(3000, 64);
    write('images/marco.jpg', avatar);
    write('images/banks.jpg', banks);
    write('images/selfie.jpg', selfie);
    write('images/watch.jpg', watch);
    write(
      'index.html',
      `<div class="comments">
  <div class="comment">
    <img src="images/marco.jpg" alt="">
    <div class="name">Marco Rossi</div>
    <p>Guarda lo screenshot del bonifico.</p>
    <img src="images/banks.jpg" alt="">
  </div>
  <div class="comment">
    <img src="images/marco.jpg" class="avatar" alt="">
    <div class="name">Marco Rossi</div>
    <p>Altro screenshot.</p>
    <figure><img src="images/selfie.jpg" alt=""></figure>
  </div>
  <div class="comment">
    <div class="name">Luca Bianchi</div>
    <p>Solo testo.</p>
    <img src="images/watch.jpg" alt="">
  </div>
</div>`,
    );
    const result = buildAiMaterials(dir, 'x', '2026-10-26');
    const photoKey = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
    expect(result.commentAvatars.map((item) => item.name)).toEqual(['Marco Rossi', 'Marco Rossi']);
    expect(result.commentAvatars.map((item) => item.photoKey)).toEqual([photoKey(avatar), photoKey(avatar)]);
    expect(result.images.find((image) => image.file === 'images/marco.jpg')).toMatchObject({ kind: 'comment', proof: false });
    expect(result.images.find((image) => image.file === 'images/banks.jpg')).toMatchObject({ kind: 'comment', proof: true });
    expect(result.images.find((image) => image.file === 'images/selfie.jpg')).toMatchObject({ kind: 'comment', proof: true });
    expect(result.images.find((image) => image.file === 'images/watch.jpg')).toMatchObject({ kind: 'comment', proof: true });
    const enforced = enforceCommentAvatars(
      { findings: [], report: { checks: [{ category: 9, status: 'PASS' }] } },
      { pageText: result.pageText, avatars: result.commentAvatars },
    );
    expect(enforced.findings.map((finding) => finding.problem ?? '')).toEqual([]);
    expect(enforced.report?.checks?.find((check) => check.category === 9)?.status).toBe('PASS');
  });
});

describe('QA_INSTRUCTION', () => {
  it('is the exact text of docs/instruction.md', () => {
    const doc = fs
      .readFileSync(path.join(__dirname, '..', '..', 'docs', 'instruction.md'), 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n');
    expect(QA_INSTRUCTION).toBe(doc);
  });
});

describe('qa-response mapper', () => {
  const pageText = 'Mifix   platform.\nMinimum deposit 250 PLN. Andrzej Duda invests.';

  it('maps screenshot refs to data URLs and keeps optional finding fields', () => {
    const result = mapQaResponse(
      {
        report_markdown: 'ОБЩАЯ ИНФОРМАЦИЯ\nGEO: Польша',
        findings: [
          {
            file: 'index.html',
            quote: 'Minimum deposit 250 PLN',
            screenshot_ref: 'I1',
            category: 6,
            priority: 'Major',
            where: 'абзац 2',
            problem: 'p',
            expected: 'e',
          },
          { file: 'index.html', quote: 'Mifix platform', screenshot_ref: 'desktop', category: '7', priority: 'bogus' },
        ],
        checks: [],
      },
      { pageText, screenshots: { I1: 'data:image/jpeg;base64,AA', desktop: 'data:image/jpeg;base64,BB' } },
    );
    expect(result.findings).toEqual([
      {
        file: 'index.html',
        quote: 'Minimum deposit 250 PLN',
        screenshot: 'data:image/jpeg;base64,AA',
        category: 6,
        priority: 'major',
        where: 'абзац 2',
        problem: 'p',
        expected: 'e',
      },
      { file: 'index.html', quote: 'Mifix platform', screenshot: 'data:image/jpeg;base64,BB', category: 7 },
    ]);
  });

  it('drops findings whose quote is not in the page text (whitespace-normalized) when text is non-empty', () => {
    const body = {
      findings: [
        { file: 'index.html', quote: 'Mifix platform.', screenshot_ref: 'desktop' },
        { file: 'index.html', quote: 'made up quote', screenshot_ref: 'desktop' },
      ],
    };
    expect(mapQaResponse(body, { pageText }).findings.map((f) => f.quote)).toEqual(['Mifix platform.']);
    expect(mapQaResponse(body, { pageText: '' }).findings).toHaveLength(2);
    expect(mapQaResponse(body, {}).findings).toHaveLength(2);
  });

  it('keeps an attached-image finding when the quote is on the page and problem cites digits that are not', () => {
    const text = 'Pedí un retiro por Bizum. Llegó en 40 minutos.';
    const shot = 'data:image/webp;base64,QQ';
    const kept = mapQaResponse(
      {
        checks: [{ category: 10, status: 'FAIL' }],
        findings: [
          {
            file: 'index.html',
            quote: 'Llegó en 40 minutos.',
            screenshot_ref: 'I4',
            problem: 'На кадре Saldo total 3.312,00 € и Saldo disponible 9.000,00 €',
            category: 10,
          },
        ],
      },
      { pageText: text, attachmentLabels: ['I4', 'preview'], screenshots: { I4: shot } },
    );
    expect(kept.findings).toEqual([
      expect.objectContaining({
        quote: 'Llegó en 40 minutos.',
        screenshot: shot,
        problem: 'На кадре Saldo total 3.312,00 € и Saldo disponible 9.000,00 €',
      }),
    ]);
    expect(kept.report?.checks).toEqual([expect.objectContaining({ category: 10, status: 'FAIL' })]);
    const dropped = mapQaResponse(
      {
        checks: [{ category: 10, status: 'FAIL' }],
        findings: [
          {
            file: 'index.html',
            quote: '3.312,00 €',
            screenshot_ref: 'I4',
            problem: 'Saldo total 3.312,00 € и Saldo disponible 9.000,00 €',
            category: 10,
          },
        ],
      },
      { pageText: text, attachmentLabels: ['I4', 'preview', 'desktop'], screenshots: { I4: shot } },
    );
    expect(dropped.findings).toEqual([]);
    expect(dropped.report?.checks).toEqual([{ category: 10, status: 'N/A', note: 'Нет подтверждённой находки' }]);
  });

  it('strips the «Общий результат» line from report_markdown', () => {
    const md = 'ИТОГ\n\nПодтверждённых ошибок: 1.\nMajor: 1.\n\nОбщий результат: FAIL\n';
    expect(stripOverallLine(md)).toBe('ИТОГ\n\nПодтверждённых ошибок: 1.\nMajor: 1.');
    const result = mapQaResponse({ report_markdown: `${md}**Общий результат:** FAIL`, checks: [] });
    expect(result.report?.report_markdown).not.toMatch(/Общий результат/i);
    expect(result.report?.report_markdown).toContain('Подтверждённых ошибок: 1.');
  });

  it('downgrades FAIL checks that have no finding to N/A, keeps PASS/N/A and FAIL with a finding', () => {
    const result = mapQaResponse(
      {
        report_markdown: 'x',
        checks: [
          { category: 1, status: 'PASS', note: 'ok' },
          { category: 5, status: 'FAIL', note: 'валюта' },
          { category: 6, status: 'FAIL' },
          { category: 7, status: 'N/A' },
          { category: 6, status: 'PASS' },
          { category: 12, status: 'PASS' },
          { category: 8, status: 'MAYBE' },
        ],
        findings: [{ file: 'index.html', quote: 'Minimum deposit 250 PLN', screenshot_ref: 'desktop', category: 6 }],
      },
      { pageText, screenshots: { desktop: 'data:image/jpeg;base64,BB' } },
    );
    expect(result.report?.checks?.map((check) => [check.category, check.status])).toEqual([
      [1, 'PASS'],
      [5, 'N/A'],
      [6, 'FAIL'],
      [7, 'N/A'],
    ]);
  });

  it('downgrades FAIL when its only finding was dropped for a quote missing from the page', () => {
    const result = mapQaResponse(
      {
        checks: [{ category: 9, status: 'FAIL' }],
        findings: [{ file: 'index.html', quote: 'not on the page', screenshot_ref: 'desktop', category: 9 }],
      },
      { pageText },
    );
    expect(result.findings).toEqual([]);
    expect(result.report?.checks).toEqual([
      { category: 9, status: 'N/A', note: 'Нет подтверждённой находки' },
    ]);
  });

  it('keeps general and clarifications and never emits verdict-like keys', () => {
    const result = mapQaResponse({
      report_markdown: 'x',
      general: { geo: 'Польша', offer: 'Mifix', verdict: 'FAIL', min_deposit: 250 },
      clarifications: ['уточнить', '', 7],
      checks: [],
    });
    expect(result.report?.general).toEqual({ geo: 'Польша', offer: 'Mifix', min_deposit: '250' });
    expect(result.report?.clarifications).toEqual(['уточнить']);
    expect(JSON.stringify(result)).not.toMatch(/verdict|overall_status/);
  });

  it('parses legacy findings-only JSON without a report', () => {
    const result = mapQaResponse(
      { findings: [{ file: 'a.html', quote: 'q', screenshot: 's' }, { file: 'b.html', quote: 'q' }] },
      { pageText: 'a q b' },
    );
    expect(result).toEqual({
      findings: [
        { file: 'a.html', quote: 'q', screenshot: 's' },
        { file: 'b.html', quote: 'q', screenshot: 'страница' },
      ],
    });
    expect(result.report).toBeUndefined();
  });
});

describe('image correspondence', () => {
  const pageText = 'Martín Guerra, en entrevista exclusiva';
  const shot = 'data:image/webp;base64,QQ';
  const hero = {
    ref: 'I1',
    file: 'images/p1.webp',
    alt: '',
    caption: '',
    context: 'Martín Guerra, en entrevista',
    claims_person: 'Martín Guerra',
  };
  const comment = {
    ref: 'I3',
    file: 'images/1.webp',
    alt: '',
    caption: '',
    context: 'comentario',
    claims_person: null,
  };

  it('turns a mismatch into a category 3 finding and FAIL', () => {
    const mapped = mapQaResponse(
      { report_markdown: 'ИТОГ', checks: [{ category: 10, status: 'PASS', note: 'ок' }], findings: [] },
      { pageText, screenshots: { I1: shot } },
    );
    const result = enforceImageCorrespondence(mapped, {
      pageText,
      screenshots: { I1: shot },
      images: [hero, comment],
      imageChecks: [{ ref: 'I1', match: 'mismatch', note: 'На фото другой человек' }],
    });
    expect(result.findings).toEqual([
      {
        file: 'index.html',
        quote: 'Martín Guerra',
        screenshot: shot,
        category: 3,
        priority: 'major',
        where: 'images/p1.webp',
        problem: 'На фото другой человек',
        expected: 'Изображение Martín Guerra',
      },
    ]);
    expect(result.report?.checks).toEqual([
      { category: 3, status: 'FAIL', note: 'Изображение I1 не соответствует «Martín Guerra»' },
      { category: 10, status: 'PASS', note: 'ок' },
    ]);
  });

  it('does not duplicate a mismatch the model already reported', () => {
    const mapped = mapQaResponse(
      {
        checks: [{ category: 10, status: 'FAIL' }],
        findings: [{ file: 'index.html', quote: 'Martín Guerra', screenshot_ref: 'I1', category: 10 }],
      },
      { pageText, screenshots: { I1: shot } },
    );
    const result = enforceImageCorrespondence(mapped, {
      pageText,
      screenshots: { I1: shot },
      images: [hero],
      imageChecks: [{ ref: 'I1', match: 'mismatch', note: 'другой' }],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.report?.clarifications).toBeUndefined();
  });

  it('keeps an uncertain face in clarifications and leaves PASS', () => {
    const mapped = mapQaResponse(
      { checks: [{ category: 10, status: 'PASS' }], findings: [] },
      { pageText, screenshots: { I1: shot } },
    );
    const result = enforceImageCorrespondence(mapped, {
      pageText,
      screenshots: { I1: shot },
      images: [hero],
      imageChecks: [{ ref: 'I1', match: 'uncertain', note: 'лица не видно' }],
    });
    expect(result.findings).toEqual([]);
    expect(result.report?.checks).toEqual([{ category: 10, status: 'PASS' }]);
    expect(result.report?.clarifications).toEqual([
      'I1 (images/p1.webp): соответствие «Martín Guerra» — не подтверждено. лица не видно',
    ]);
  });

  it('records a missing verdict as unchecked and ignores a match', () => {
    const second = { ...hero, ref: 'I2', file: 'images/photo2.webp' };
    const mapped = mapQaResponse({ report_markdown: 'ИТОГ', findings: [] }, { pageText, screenshots: { I1: shot, I2: shot } });
    const result = enforceImageCorrespondence(mapped, {
      pageText,
      screenshots: { I1: shot, I2: shot },
      images: [hero, second],
      imageChecks: [{ ref: 'I1', match: 'match', note: 'тот же человек' }],
    });
    expect(result.findings).toEqual([]);
    expect(result.report?.clarifications).toEqual([
      'I2 (images/photo2.webp): соответствие «Martín Guerra» — не проверено',
    ]);
  });

  it('does not invent a finding when the page has no quote for the mismatch', () => {
    const mapped = mapQaResponse({ report_markdown: 'ИТОГ', findings: [] }, { pageText: 'другой текст', screenshots: { I1: shot } });
    const result = enforceImageCorrespondence(mapped, {
      pageText: 'другой текст',
      screenshots: { I1: shot },
      images: [hero],
      imageChecks: [{ ref: 'I1', match: 'не соответствует' }],
    });
    expect(result.findings).toEqual([]);
    expect(result.report?.clarifications).toEqual([
      'I1 (images/p1.webp): соответствие «Martín Guerra» — несоответствие, находка не собрана',
    ]);
  });

  it('writes index.php into a mismatch finding when the landing has only that index', () => {
    const mapped = mapQaResponse(
      { report_markdown: 'ИТОГ', checks: [{ category: 3, status: 'PASS', note: 'ок' }], findings: [] },
      { pageText, screenshots: { I1: shot } },
    );
    const result = enforceImageCorrespondence(mapped, {
      pageText,
      screenshots: { I1: shot },
      images: [hero],
      imageChecks: [{ ref: 'I1', match: 'mismatch', note: 'На фото другой человек' }],
      indexFile: 'index.php',
    });
    expect(result.findings).toEqual([
      {
        file: 'index.php',
        quote: 'Martín Guerra',
        screenshot: shot,
        category: 3,
        priority: 'major',
        where: 'images/p1.webp',
        problem: 'На фото другой человек',
        expected: 'Изображение Martín Guerra',
      },
    ]);
    expect(result.report?.checks?.find((check) => check.category === 3)?.status).toBe('FAIL');
  });
});
