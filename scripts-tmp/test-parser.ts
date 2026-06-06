// Simulate the fix locally using same logic
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const data = new Uint8Array(await Bun.file('/tmp/bas/BAS0485A.pdf').arrayBuffer());
const doc = await getDocument({ data }).promise;
type Item = { str: string; x: number; y: number };
const itens: Item[] = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  for (const it of tc.items as any[]) {
    if (!it.str || !it.str.trim()) continue;
    itens.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
  }
}

const RE_KEY = /^(?:CONTORNO_TECNICO|FIM_CONTORNO_TECNICO|CODIGO\s*[:=]|TIPO\s*[:=]|FACE_PRINCIPAL\s*[:=]|RECORTE_[XY]\s*[:=]|PONTOS(?:_CONTORNO)?\s*[:=])/i;
const RE_ANOT = /^(?:CONTORNO[\s_]+TECNICO[\s_]+ADICIONADO|Este\s+bloco\s+foi\s+adicionado|Esquema\s+do\s+contorno|RY\s*=|RX\s*=)/i;

const removidos: string[] = [];
const limpos: Item[] = [];
for (const it of itens) {
  const s = it.str.trim();
  if (RE_KEY.test(s) || RE_ANOT.test(s)) { removidos.push(s); continue; }
  limpos.push(it);
}
console.log('Removidos (', removidos.length, '):');
for (const r of removidos) console.log('  ', r);

// agrupa linhas
const byY = new Map<number, Item[]>();
for (const it of limpos) {
  const k = Math.round(it.y);
  const arr = byY.get(k) ?? [];
  arr.push(it); byY.set(k, arr);
}
const ys = [...byY.keys()].sort((a,b)=>b-a);
console.log('\nLinhas com Face/numéricas:');
for (const y of ys) {
  const line = byY.get(y)!.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').replace(/\s+/g,' ').trim();
  if (!line) continue;
  if (/Furação|Face\s*\d|Rasgo/.test(line) || line.split(/\s+/).filter(t=>/^-?\d/.test(t)).length>=4) {
    console.log(y, '|', line);
  }
}
