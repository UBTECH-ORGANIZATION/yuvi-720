/**
 * Print every HTML file in a directory to A4 PDF using the Chromium that
 * Playwright already installs. Invoked by scripts/build_tender_pdfs.py.
 *
 *   node scripts/html_to_pdf.mjs <htmlDir> <pdfOutDir>
 */
import { chromium } from 'playwright';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const [htmlDir, outDir] = process.argv.slice(2);
if (!htmlDir || !outDir) {
  console.error('usage: node html_to_pdf.mjs <htmlDir> <pdfOutDir>');
  process.exit(2);
}

const files = (await readdir(htmlDir)).filter((f) => f.endsWith('.html')).sort();
const browser = await chromium.launch();
const page = await browser.newPage();

for (const file of files) {
  const source = join(htmlDir, file);
  await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
  const out = join(outDir, `${basename(file, '.html')}.pdf`);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    // Page numbers matter for a document a committee will print and discuss.
    footerTemplate:
      '<div style="width:100%;font-family:Arial,sans-serif;font-size:8pt;' +
      'color:#666;text-align:center;">' +
      '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '18mm', bottom: '16mm', left: '16mm', right: '16mm' },
  });
  const bytes = (await readFile(out)).length;
  console.log(`  pdf   ${basename(out)}  (${Math.round(bytes / 1024)} KB)`);
}

await browser.close();
