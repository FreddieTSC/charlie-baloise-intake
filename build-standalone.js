// Build a fully offline, single-file standalone of the Charlie demo.
// - Embeds the Inter webfont (base64) so typography is identical offline.
// - Removes the Google Fonts <link> and the 3 CDN <script> tags (cfb/pdf.js/jszip),
//   which are only used for real file uploads (guarded; not used by the demo).
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Raleway:wght@500;600;700;800&display=swap';
const WANT_SUBSETS = ['latin', 'latin-ext'];

async function main() {
  let html = fs.readFileSync('index.html', 'utf8');

  // 1. Fetch the Google Fonts CSS (Chrome UA -> woff2)
  let embeddedCss = '';
  try {
    const cssRes = await fetch(FONT_CSS_URL, { headers: { 'User-Agent': UA } });
    const css = await cssRes.text();

    // The CSS is a sequence of: /* subset */ \n @font-face { ... }
    const blocks = css.split(/\/\*\s*([\w-]+)\s*\*\//).slice(1); // [subset, block, subset, block, ...]
    const faces = [];
    for (let i = 0; i < blocks.length; i += 2) {
      const subset = blocks[i].trim();
      const body = blocks[i + 1] || '';
      if (!WANT_SUBSETS.includes(subset)) continue;
      const family = (body.match(/font-family:\s*'([^']+)'/) || [])[1] || 'Inter';
      const style = (body.match(/font-style:\s*(\w+)/) || [])[1] || 'normal';
      const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
      const url = (body.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/) || [])[1];
      const range = (body.match(/unicode-range:\s*([^;]+);/) || [])[1];
      if (!url) continue;
      faces.push({ subset, family, style, weight, url, range });
    }

    for (const f of faces) {
      const buf = Buffer.from(await (await fetch(f.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
      const b64 = buf.toString('base64');
      embeddedCss += `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;` +
        `src:url(data:font/woff2;base64,${b64}) format('woff2');` +
        (f.range ? `unicode-range:${f.range.trim()};` : '') + `}\n`;
    }
    console.log(`Embedded ${faces.length} @font-face blocks (${WANT_SUBSETS.join('+')}) across Inter + Raleway.`);
  } catch (e) {
    console.warn('Font embed failed (' + e.message + ') — standalone will fall back to system fonts.');
  }

  // 2. Replace the Google Fonts <link> with an inline <style> (or just drop it)
  const linkRe = /<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/;
  const replacement = embeddedCss ? `<style>\n${embeddedCss}</style>\n` : '';
  if (!linkRe.test(html)) { console.error('Google Fonts link not found'); process.exit(1); }
  html = html.replace(linkRe, replacement);

  // 3. Remove the 3 CDN script tags (guarded usage; not needed for the demo)
  html = html.replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/cfb@[^"]*"><\/script>/, '');
  html = html.replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@[^"]*"><\/script>/, '');
  html = html.replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jszip@[^"]*"><\/script>/, '');

  // 3b. Neutralise the guarded (offline-unused) pdf.js worker URL → leaves zero external refs
  html = html.replace(/(pdfjsLib\.GlobalWorkerOptions\.workerSrc\s*=\s*)'[^']*'/, "$1''");

  // 4. Embed the demo photos (otherwise the Multimedia tab is broken offline)
  let photoCount = 0;
  if (fs.existsSync('demo')) {
    for (const fn of fs.readdirSync('demo')) {
      if (!/\.(jpe?g|png|gif|webp)$/i.test(fn)) continue;
      const mime = /\.png$/i.test(fn) ? 'image/png' : /\.gif$/i.test(fn) ? 'image/gif'
        : /\.webp$/i.test(fn) ? 'image/webp' : 'image/jpeg';
      const b64 = fs.readFileSync('demo/' + fn).toString('base64');
      const path = 'demo/' + fn;
      if (html.includes(path)) { html = html.split(path).join(`data:${mime};base64,${b64}`); photoCount++; }
    }
  }
  console.log(`Embedded ${photoCount} demo photo(s).`);

  // 5. Sanity: no remaining external/relative resource that would block offline
  const leftover = (html.match(/(?:href|src)\s*[:=]\s*["']?(?:https?:\/\/|demo\/|\.\/)[^"')\s]+/g) || [])
    .filter(s => !s.includes('data:'));
  if (leftover.length) console.warn('Note — remaining external/relative refs (verify these are demo-unused):\n  ' + leftover.join('\n  '));

  fs.writeFileSync('charlie-demo-standalone.html', html, 'utf8');
  const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  console.log(`Wrote charlie-demo-standalone.html (${kb} KB).`);
}
main();
