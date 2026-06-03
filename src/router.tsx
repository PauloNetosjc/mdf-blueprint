import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Dados ficam "frescos" por 5 min — evita refetch ao trocar de aba.
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Pré-carrega a rota ao passar o mouse / focar no link.
    defaultPreload: "intent",
    // Cache de preload alinhado ao staleTime das queries.
    defaultPreloadStaleTime: 0,
  });

  return router;
};
