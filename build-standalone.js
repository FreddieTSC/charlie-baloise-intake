// Build a fully offline, single-file standalone of the Charlie demo.
// - Embeds the Inter webfont (base64) so typography is identical offline.
// - Removes the Google Fonts <link> and the 3 CDN <script> tags (cfb/pdf.js/jszip),
//   which are only used for real file uploads (guarded; not used by the demo).
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
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
      const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
      const url = (body.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/) || [])[1];
      const range = (body.match(/unicode-range:\s*([^;]+);/) || [])[1];
      if (!url) continue;
      faces.push({ subset, weight, url, range });
    }

    for (const f of faces) {
      const buf = Buffer.from(await (await fetch(f.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
      const b64 = buf.toString('base64');
      embeddedCss += `@font-face{font-family:'Inter';font-style:normal;font-weight:${f.weight};font-display:swap;` +
        `src:url(data:font/woff2;base64,${b64}) format('woff2');` +
        (f.range ? `unicode-range:${f.range.trim()};` : '') + `}\n`;
    }
    console.log(`Embedded ${faces.length} Inter @font-face blocks (${WANT_SUBSETS.join('+')}).`);
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

  // 4. Sanity: no remaining external http(s) resource that would block offline
  const leftover = (html.match(/(?:href|src)="https?:\/\/[^"]+"/g) || []).filter(s => !s.includes('data:'));
  if (leftover.length) console.warn('Note — remaining external refs (not blocking, used only in non-demo handlers):\n  ' + leftover.join('\n  '));

  fs.writeFileSync('charlie-demo-standalone.html', html, 'utf8');
  const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  console.log(`Wrote charlie-demo-standalone.html (${kb} KB).`);
}
main();
