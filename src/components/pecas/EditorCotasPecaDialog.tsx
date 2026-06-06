// Editor manual de cotas da peça cadastrada (MVP).
//
// Permite ao usuário corrigir manualmente medidas gerais, contorno (incluindo
// geometria em L), faces visuais e visualizar uma prévia antes de salvar.
// Não mexe no parser. Apenas atualiza o modelo técnico canônico salvo em
// `pecas_cadastradas.dados_brutos_json.modelo_tecnico_json` (mais
// `contorno_externo_json`, `diagnostico_geometria` e refs de cota da linha
// da peça).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import {
  salvarEdicaoManualCotas,
  type EdicaoManualCotasInput,
  type FaceVisualInput,
  type ModeloTecnicoJson,
} from "@/lib/peca-modelo-tecnico";

type Ponto = { x: number; y: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pecaId: string;
  codigo: string;
  modelo: ModeloTecnicoJson | null;
  // operações vindas do banco (para sobrepor na prévia)
  operacoes: Array<{
    face: string | number | null;
    tipo_operacao: string;
    x: number | null;
    y: number | null;
    x1: number | null;
    x2: number | null;
    y1: number | null;
    y2: number | null;
    ordem: number;
  }>;
  largura_ref: number | null;
  altura_ref: number | null;
  espessura_ref: number | null;
  material_ref: string | null;
  fita_ref: string | null;
  onSaved?: () => void;
};

const TIPO_VISTA_PADRAO: Record<string, string> = {
  "1": "lateral_esquerda",
  "2": "inferior",
  "3": "lateral_direita",
  "4": "superior",
  "5": "lateral",
  "6": "topo",
  "7": "principal",
};

function pontoDentroDoPoligono(p: Ponto, poly: Ponto[]): boolean {
  if (poly.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) dentro = !dentro;
  }
  return dentro;
}

function geraPontosL(largura: number, altura: number, recorteX: number, recorteY: number): Ponto[] {
  return [
    { x: 0, y: 0 },
    { x: recorteX, y: 0 },
    { x: recorteX, y: recorteY },
    { x: largura, y: recorteY },
    { x: largura, y: altura },
    { x: 0, y: altura },
  ];
}

function defaultFacesVisuais(facesAtuais: FaceVisualInput[], largura: number, altura: number, espessura: number, tipo: string): FaceVisualInput[] {
  if (facesAtuais.length > 0) return facesAtuais;
  return ["1", "2", "3", "4", "5", "6", "7"].map((f) => ({
    face: f,
    tipo_vista: TIPO_VISTA_PADRAO[f],
    largura_visual: f === "7" ? largura : (f === "2" || f === "6" || f === "4") ? largura : espessura,
    altura_visual: f === "7" ? altura : (f === "1" || f === "3" || f === "5") ? altura : espessura,
    geometria: f === "7" ? tipo : "retangular",
  }));
}

export function EditorCotasPecaDialog(props: Props) {
  const { open, onOpenChange, pecaId, codigo, modelo, operacoes, onSaved } = props;

  // --- estado inicial ---
  const inicialLargura = modelo?.medidas?.largura ?? props.largura_ref ?? 0;
  const inicialAltura = modelo?.medidas?.altura ?? props.altura_ref ?? 0;
  const inicialEspessura = modelo?.medidas?.espessura ?? props.espessura_ref ?? 15;
  const inicialTipo = (modelo?.geometria?.tipo ?? "retangular") as EdicaoManualCotasInput["geometria"]["tipo"];
  const inicialPontos: Ponto[] = (modelo?.geometria?.pontos_contorno ?? []).map((p) => ({ x: p.x, y: p.y }));

  const [largura, setLargura] = useState<number>(inicialLargura || 0);
  const [altura, setAltura] = useState<number>(inicialAltura || 0);
  const [espessura, setEspessura] = useState<number>(inicialEspessura || 15);
  const [material, setMaterial] = useState<string>(modelo?.material ?? props.material_ref ?? "");
  const [fita, setFita] = useState<string>(modelo?.fita ?? props.fita_ref ?? "");
  const [facePrincipal, setFacePrincipal] = useState<string>(
    String(modelo?.geometria?.face_principal ?? "7"),
  );
  const [faceAlinhamento, setFaceAlinhamento] = useState<string>(
    String(modelo?.face_alinhamento ?? "A"),
  );

  const [tipo, setTipo] = useState<EdicaoManualCotasInput["geometria"]["tipo"]>(inicialTipo);
  const [pontos, setPontos] = useState<Ponto[]>(inicialPontos);

  // Para tipo L: derivar recorte_x e recorte_y do segundo/terceiro pontos
  // padrão: largura/2, altura/2
  const inicialRecorteX = inicialPontos.length >= 3 && inicialTipo === "L" ? inicialPontos[1].x : Math.round(inicialLargura / 2);
  const inicialRecorteY = inicialPontos.length >= 3 && inicialTipo === "L" ? inicialPontos[2].y : Math.round(inicialAltura / 2);
  const [recorteX, setRecorteX] = useState<number>(inicialRecorteX);
  const [recorteY, setRecorteY] = useState<number>(inicialRecorteY);

  const [facesVisuais, setFacesVisuais] = useState<FaceVisualInput[]>(
    defaultFacesVisuais(
      (modelo?.faces_visuais ?? []) as FaceVisualInput[],
      inicialLargura,
      inicialAltura,
      inicialEspessura,
      inicialTipo,
    ),
  );

  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<string>("medidas");

  // Reset quando abrir
  useEffect(() => {
    if (!open) return;
    setLargura(modelo?.medidas?.largura ?? props.largura_ref ?? 0);
    setAltura(modelo?.medidas?.altura ?? props.altura_ref ?? 0);
    setEspessura(modelo?.medidas?.espessura ?? props.espessura_ref ?? 15);
    setMaterial(modelo?.material ?? props.material_ref ?? "");
    setFita(modelo?.fita ?? props.fita_ref ?? "");
    setFacePrincipal(String(modelo?.geometria?.face_principal ?? "7"));
    setFaceAlinhamento(String(modelo?.face_alinhamento ?? "A"));
    const t = (modelo?.geometria?.tipo ?? "retangular") as EdicaoManualCotasInput["geometria"]["tipo"];
    setTipo(t);
    const pts = (modelo?.geometria?.pontos_contorno ?? []).map((p) => ({ x: p.x, y: p.y }));
    setPontos(pts);
    const L = modelo?.medidas?.largura ?? props.largura_ref ?? 0;
    const H = modelo?.medidas?.altura ?? props.altura_ref ?? 0;
    setRecorteX(t === "L" && pts.length >= 2 ? pts[1].x : Math.round(L / 2));
    setRecorteY(t === "L" && pts.length >= 3 ? pts[2].y : Math.round(H / 2));
    setFacesVisuais(
      defaultFacesVisuais(
        (modelo?.faces_visuais ?? []) as FaceVisualInput[],
        L, H, modelo?.medidas?.espessura ?? props.espessura_ref ?? 15, t,
      ),
    );
    setTab("medidas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Sincroniza pontos automaticamente quando estiver em modo L "simples"
  function regenerarLDeSimples() {
    if (tipo !== "L") return;
    if (!(largura > 0 && altura > 0 && recorteX > 0 && recorteY > 0)) return;
    setPontos(geraPontosL(largura, altura, recorteX, recorteY));
  }

  // --- pontos: ações ---
  function moverPonto(i: number, dir: -1 | 1) {
    setPontos((prev) => {
      const arr = prev.slice();
      const j = i + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }
  function removerPonto(i: number) {
    setPontos((prev) => prev.filter((_, k) => k !== i));
  }
  function adicionarPonto() {
    setPontos((prev) => [...prev, { x: 0, y: 0 }]);
  }
  function alterarPonto(i: number, campo: "x" | "y", valor: number) {
    setPontos((prev) => prev.map((p, k) => (k === i ? { ...p, [campo]: valor } : p)));
  }

  // --- faces visuais: ações ---
  function alterarFaceVisual(i: number, patch: Partial<FaceVisualInput>) {
    setFacesVisuais((prev) => prev.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  }

  // --- validação local ---
  const erroValidacao = useMemo(() => {
    if (!(largura > 0) || !(altura > 0)) return "Largura e altura devem ser maiores que zero.";
    if (!(espessura > 0)) return "Espessura deve ser maior que zero.";
    if (pontos.length < 4) return "O contorno precisa ter pelo menos 4 pontos.";
    if (tipo === "L" && pontos.length < 6) return "Geometria em L precisa ter pelo menos 6 pontos.";
    return null;
  }, [largura, altura, espessura, pontos, tipo]);

  // --- prévia ---
  const pontosAnteriores: Ponto[] = inicialPontos;

  async function handleSalvar() {
    if (erroValidacao) {
      toast.error(erroValidacao);
      return;
    }
    setSaving(true);
    try {
      const input: EdicaoManualCotasInput = {
        medidas: { largura, altura, espessura },
        material: material || null,
        fita: fita || null,
        face_principal: facePrincipal || null,
        face_alinhamento: faceAlinhamento || null,
        geometria: { tipo, pontos_contorno: pontos },
        faces_visuais: facesVisuais.map((f) => ({
          face: String(f.face),
          tipo_vista: f.tipo_vista ?? null,
          largura_visual: f.largura_visual ?? null,
          altura_visual: f.altura_visual ?? null,
          geometria: f.geometria ?? null,
        })),
      };
      const res = await salvarEdicaoManualCotas(pecaId, input);
      if (res.validacao.erros.length > 0) {
        toast.warning(`Cotas salvas com avisos: ${res.validacao.erros[0]}`);
      } else {
        toast.success("Cotas da peça atualizadas.");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao salvar cotas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Editar cotas da peça — {codigo}</DialogTitle>
          <DialogDescription>
            Edição manual segura do modelo técnico (medidas, contorno e faces visuais).
            Não altera o parser. O modelo salvo é usado pelo visualizador e pela geração de G-code.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="medidas">Medidas gerais</TabsTrigger>
            <TabsTrigger value="contorno">Contorno</TabsTrigger>
            <TabsTrigger value="faces">Faces visuais</TabsTrigger>
            <TabsTrigger value="previa">Prévia</TabsTrigger>
          </TabsList>

          {/* MEDIDAS GERAIS */}
          <TabsContent value="medidas" className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Largura (mm)">
                <Input type="number" step="0.1" value={largura} onChange={(e) => setLargura(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Altura (mm)">
                <Input type="number" step="0.1" value={altura} onChange={(e) => setAltura(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Espessura (mm)">
                <Input type="number" step="0.1" value={espessura} onChange={(e) => setEspessura(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Material">
                <Input value={material} onChange={(e) => setMaterial(e.target.value)} />
              </Field>
              <Field label="Fita">
                <Input value={fita} onChange={(e) => setFita(e.target.value)} />
              </Field>
              <Field label="Face principal">
                <Input value={facePrincipal} onChange={(e) => setFacePrincipal(e.target.value)} />
              </Field>
              <Field label="Face de alinhamento">
                <Input value={faceAlinhamento} onChange={(e) => setFaceAlinhamento(e.target.value)} />
              </Field>
            </div>
          </TabsContent>

          {/* CONTORNO */}
          <TabsContent value="contorno" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded border border-border bg-muted/30 p-3">
              <Field label="Tipo de geometria">
                <select
                  className="h-9 rounded border bg-background px-2 text-sm"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as EdicaoManualCotasInput["geometria"]["tipo"])}
                >
                  <option value="retangular">retangular</option>
                  <option value="L">L</option>
                  <option value="recortada">recortada</option>
                  <option value="poligono_complexo">poligono_complexo</option>
                </select>
              </Field>
              {tipo === "L" && (
                <>
                  <Field label="Largura total">
                    <Input type="number" step="0.1" value={largura} onChange={(e) => setLargura(parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Field label="Altura total">
                    <Input type="number" step="0.1" value={altura} onChange={(e) => setAltura(parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Field label="Recorte X">
                    <Input type="number" step="0.1" value={recorteX} onChange={(e) => setRecorteX(parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Field label="Recorte Y">
                    <Input type="number" step="0.1" value={recorteY} onChange={(e) => setRecorteY(parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Button size="sm" type="button" onClick={regenerarLDeSimples}>
                    Gerar 6 pontos do L
                  </Button>
                </>
              )}
              {tipo === "retangular" && (
                <Button
                  size="sm"
                  type="button"
                  onClick={() =>
                    setPontos([
                      { x: 0, y: 0 },
                      { x: largura, y: 0 },
                      { x: largura, y: altura },
                      { x: 0, y: altura },
                    ])
                  }
                >
                  Gerar 4 pontos do retângulo
                </Button>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pontos do contorno ({pontos.length})
                </div>
                <Button size="sm" variant="outline" type="button" onClick={adicionarPonto}>
                  <Plus className="mr-1 h-3 w-3" /> Adicionar ponto
                </Button>
              </div>
              <div className="max-h-80 overflow-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">X</th>
                      <th className="px-2 py-1 text-left">Y</th>
                      <th className="px-2 py-1 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pontos.map((p, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1 font-mono">{i + 1}</td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" step="0.01"
                            value={p.x}
                            onChange={(e) => alterarPonto(i, "x", parseFloat(e.target.value) || 0)}
                            className="h-7"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" step="0.01"
                            value={p.y}
                            onChange={(e) => alterarPonto(i, "y", parseFloat(e.target.value) || 0)}
                            className="h-7"
                          />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Button size="icon" variant="ghost" type="button" onClick={() => moverPonto(i, -1)} disabled={i === 0}>
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" type="button" onClick={() => moverPonto(i, 1)} disabled={i === pontos.length - 1}>
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" type="button" onClick={() => removerPonto(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {pontos.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-4 text-center text-xs text-muted-foreground">
                          Sem pontos. Use "Gerar 6 pontos do L" ou "Adicionar ponto".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                A ordem dos pontos é preservada — nada é reordenado nem fechado por convex hull.
                O polígono é fechado visualmente ligando o último ponto ao primeiro.
              </p>
            </div>
          </TabsContent>

          {/* FACES VISUAIS */}
          <TabsContent value="faces" className="space-y-2">
            <div className="max-h-96 overflow-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="px-2 py-1 text-left">Face</th>
                    <th className="px-2 py-1 text-left">tipo_vista</th>
                    <th className="px-2 py-1 text-left">largura_visual</th>
                    <th className="px-2 py-1 text-left">altura_visual</th>
                    <th className="px-2 py-1 text-left">geometria</th>
                  </tr>
                </thead>
                <tbody>
                  {facesVisuais.map((f, i) => (
                    <tr key={f.face + i} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">F{f.face}</td>
                      <td className="px-2 py-1">
                        <Input
                          value={f.tipo_vista ?? ""}
                          onChange={(e) => alterarFaceVisual(i, { tipo_vista: e.target.value })}
                          className="h-7"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number" step="0.1"
                          value={f.largura_visual ?? 0}
                          onChange={(e) => alterarFaceVisual(i, { largura_visual: parseFloat(e.target.value) || 0 })}
                          className="h-7"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number" step="0.1"
                          value={f.altura_visual ?? 0}
                          onChange={(e) => alterarFaceVisual(i, { altura_visual: parseFloat(e.target.value) || 0 })}
                          className="h-7"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={f.geometria ?? ""}
                          onChange={(e) => alterarFaceVisual(i, { geometria: e.target.value })}
                          className="h-7"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* PRÉVIA */}
          <TabsContent value="previa" className="space-y-2">
            <PreviaContorno
              largura={largura}
              altura={altura}
              pontosAntigos={pontosAnteriores}
              pontosNovos={pontos}
              operacoes={operacoes}
              faceAlvo={facePrincipal}
            />
            <p className="text-xs text-muted-foreground">
              Cinza: contorno anterior. Azul: contorno novo. Pontos vermelhos: operações
              da face principal fora do contorno novo.
            </p>
          </TabsContent>
        </Tabs>

        {erroValidacao && (
          <div className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {erroValidacao}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="mr-1 h-4 w-4" /> Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={saving || !!erroValidacao}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Salvando..." : "Salvar cotas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function PreviaContorno({
  largura,
  altura,
  pontosAntigos,
  pontosNovos,
  operacoes,
  faceAlvo,
}: {
  largura: number;
  altura: number;
  pontosAntigos: Ponto[];
  pontosNovos: Ponto[];
  operacoes: Props["operacoes"];
  faceAlvo: string;
}) {
  const W = Math.max(largura, 1);
  const H = Math.max(altura, 1);
  const pad = 20;
  const vw = 600;
  const scale = (vw - 2 * pad) / W;
  const vh = H * scale + 2 * pad;

  const pathFromPts = (pts: Ponto[]) =>
    pts.length === 0
      ? ""
      : pts.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + p.x * scale} ${pad + (H - p.y) * scale}`).join(" ") + " Z";

  const opsFace = operacoes.filter((o) => String(o.face ?? "") === String(faceAlvo));
  const pontosOps: Array<{ x: number; y: number; ordem: number; tipo: string }> = [];
  for (const o of opsFace) {
    if (o.x != null && o.y != null) pontosOps.push({ x: o.x, y: o.y, ordem: o.ordem, tipo: o.tipo_operacao });
    if (o.x1 != null && o.x2 != null && o.y1 != null && o.y2 != null) {
      pontosOps.push({ x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2, ordem: o.ordem, tipo: o.tipo_operacao });
    }
  }
  const totalFora = pontosOps.filter((p) => !pontoDentroDoPoligono(p, pontosNovos)).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">Antigo: {pontosAntigos.length} pts</Badge>
        <Badge variant="outline">Novo: {pontosNovos.length} pts</Badge>
        <Badge variant={totalFora > 0 ? "destructive" : "secondary"}>
          {totalFora} operação(ões) fora do contorno (face {faceAlvo})
        </Badge>
      </div>
      <div className="rounded border border-border bg-background">
        <svg width="100%" viewBox={`0 0 ${vw} ${vh}`} className="block">
          <rect x={0} y={0} width={vw} height={vh} fill="hsl(var(--muted))" opacity={0.2} />
          {pontosAntigos.length >= 3 && (
            <path d={pathFromPts(pontosAntigos)} fill="none" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1.5} />
          )}
          {pontosNovos.length >= 3 && (
            <path d={pathFromPts(pontosNovos)} fill="hsl(var(--primary))" fillOpacity={0.08} stroke="hsl(var(--primary))" strokeWidth={2} />
          )}
          {pontosOps.map((p, i) => {
            const dentro = pontoDentroDoPoligono(p, pontosNovos);
            return (
              <circle
                key={i}
                cx={pad + p.x * scale}
                cy={pad + (H - p.y) * scale}
                r={3}
                fill={dentro ? "hsl(var(--foreground))" : "hsl(var(--destructive))"}
                opacity={0.9}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
