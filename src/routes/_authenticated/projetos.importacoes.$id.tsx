import { createFileRoute } from "@tanstack/react-router";
import { ImportacaoDetalhe } from "./importacoes.$id";

export const Route = createFileRoute("/_authenticated/projetos/importacoes/$id")({
  head: () => ({ meta: [{ title: "Importação — Visualizador CNC" }] }),
  component: ImportacaoDetalhe,
});
