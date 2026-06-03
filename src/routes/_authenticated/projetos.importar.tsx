import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/projetos/importar")({
  beforeLoad: () => {
    throw redirect({ to: "/projetos/importacoes" });
  },
  component: () => null,
});
