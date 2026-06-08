// Helper genérico para resolver a face principal de uma peça, sem hardcoded
// "L = F7". A ordem de prioridade reflete a confiabilidade da fonte.

export type OrigemFacePrincipal =
  | "modelo.geometria.face_principal"
  | "modelo.face_principal"
  | "contorno_tecnico_pdf.face_principal"
  | "fallback_face_visual"
  | "fallback_face_operacional"
  | "fallback_default_L"
  | "indefinida";

export type FacePrincipalResolvida = {
  face: string | null;
  origem: OrigemFacePrincipal;
};

type ModeloMin = {
  geometria?: {
    tipo?: string | null;
    face_principal?: string | number | null;
  } | null;
  face_principal?: string | number | null;
  faces_visuais?: Array<{ face: string | number }> | null;
  faces_operacionais?: Array<{ face: string | number }> | null;
} | null | undefined;

type ContornoMin = {
  face_principal?: string | number | null;
} | null | undefined;

export function obterFacePrincipal(
  modelo: ModeloMin,
  contornoPdf?: ContornoMin,
): FacePrincipalResolvida {
  const geom = modelo?.geometria;
  if (geom?.face_principal != null && String(geom.face_principal) !== "") {
    return { face: String(geom.face_principal), origem: "modelo.geometria.face_principal" };
  }
  const fp = (modelo as { face_principal?: string | number | null } | undefined)?.face_principal;
  if (fp != null && String(fp) !== "") {
    return { face: String(fp), origem: "modelo.face_principal" };
  }
  if (contornoPdf?.face_principal != null && String(contornoPdf.face_principal) !== "") {
    return { face: String(contornoPdf.face_principal), origem: "contorno_tecnico_pdf.face_principal" };
  }
  // Fallbacks — só quando NADA explícito existe. Nunca chuta F7.
  const fv = modelo?.faces_visuais ?? [];
  if (fv.length === 1) return { face: String(fv[0].face), origem: "fallback_face_visual" };
  const fo = modelo?.faces_operacionais ?? [];
  if (fo.length === 1) return { face: String(fo[0].face), origem: "fallback_face_operacional" };
  return { face: null, origem: "indefinida" };
}
