import { QueryClient, keepPreviousData } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Dados ficam "frescos" por 5 min — evita refetch ao trocar de aba/rota.
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: 1,
        // Mantém os dados anteriores enquanto novos chegam: evita a tela
        // "piscar" para vazio entre navegações e revalidações.
        placeholderData: keepPreviousData,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Pré-carrega a rota (e o chunk JS) ao passar o mouse / focar no link.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    // Mantém o conteúdo da rota anterior visível enquanto a nova carrega
    // — sem isso o Outlet some por alguns ms e o usuário vê um flash branco.
    defaultPendingMs: 1500,
    defaultPendingMinMs: 0,
    // Cache de preload alinhado ao staleTime das queries.
    defaultPreloadStaleTime: 0,
  });

  return router;
};
