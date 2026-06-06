import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const data = new Uint8Array(await Bun.file('/tmp/bas/BAS0485A.pdf').arrayBuffer());
const doc = await getDocument({ data }).promise;
// Reproduce linha grouping: group items by Y rounded
type Item = { s: string; x: number; y: number };
const items: Item[] = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  for (const it of tc.items as any[]) {
    if (!it.str) continue;
    items.push({ s: it.str, x: it.transform[4], y: it.transform[5] });
  }
}
// group by integer y
const byY = new Map<number, Item[]>();
for (const it of items) {
  const k = Math.round(it.y);
  const arr = byY.get(k) ?? [];
  arr.push(it);
  byY.set(k, arr);
}
const ys = [...byY.keys()].sort((a,b)=>b-a);
for (const y of ys) {
  const line = byY.get(y)!.sort((a,b)=>a.x-b.x).map(i=>i.s).join(' ').replace(/\s+/g,' ').trim();
  if (!line) continue;
  if (/Furação|Face\s*\d|Rasgo|Usinage|^\d/.test(line) || line.split(/\s+/).filter(t=>/^\d/.test(t)).length>=2) {
    console.log(y, '|', line);
  }
}
