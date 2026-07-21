import { QueryClient } from "@tanstack/react-query";

export function createInboxQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const inboxQueryClient = createInboxQueryClient();
