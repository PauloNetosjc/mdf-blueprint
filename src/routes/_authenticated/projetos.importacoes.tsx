import { createFileRoute } from "@tanstack/react-router";
import { ImportacoesPage } from "./importacoes";

export const Route = createFileRoute("/_authenticated/projetos/importacoes")({
  head: () => ({ meta: [{ title: "Criar projeto por importação — Visualizador CNC" }] }),
  component: ImportacoesPage,
});
