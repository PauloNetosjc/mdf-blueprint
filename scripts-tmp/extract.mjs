import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const data = new Uint8Array(await Bun.file('/tmp/bas/BAS0485A.pdf').arrayBuffer());
const doc = await getDocument({ data }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  console.log(`--- PAGE ${p} ---`);
  for (const item of tc.items) {
    console.log(JSON.stringify({s: item.str, x: item.transform[4], y: item.transform[5]}));
  }
}
