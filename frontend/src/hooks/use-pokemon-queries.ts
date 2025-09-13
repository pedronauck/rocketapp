import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { apiCall } from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import type { PokemonQuery, PokemonQueryStats, PaginatedResponse } from '@/lib/types';

interface UsePokemonQueriesOptions {
  page?: number;
  limit?: number;
}

export function usePokemonQueries({ page = 1, limit = 10 }: UsePokemonQueriesOptions = {}) {
  const offset = (page - 1) * limit;
  return useQuery({
    queryKey: queryKeys.pokemonQueries(page, limit),
    queryFn: () =>
      apiCall<PaginatedResponse<PokemonQuery>>(`/api/pokemon-queries?offset=${offset}&limit=${limit}`),
    staleTime: 30_000,
  });
}

// Mock data for demo
const mockPokemonQueries: PokemonQuery[] = [
  {
    call_sid: 'DEMO001',
    timestamp: Date.now() - 3600000, // 1 hour ago
    pokemon_names: ['Squirtle'],
    duration: 135
  },
  {
    call_sid: 'DEMO002',
    timestamp: Date.now() - 7200000, // 2 hours ago
    pokemon_names: ['Bulbasaur'],
    duration: 140
  },
  {
    call_sid: 'DEMO003',
    timestamp: Date.now() - 10800000, // 3 hours ago
    pokemon_names: ['Charmander'],
    duration: 125
  },
  {
    call_sid: 'DEMO004',
    timestamp: Date.now() - 14400000, // 4 hours ago
    pokemon_names: ['Butterfree'],
    duration: 110
  },
  {
    call_sid: 'DEMO005',
    timestamp: Date.now() - 18000000, // 5 hours ago
    pokemon_names: ['Pikachu'],
    duration: 120
  }
];

export function usePokemonQueriesInfinite({ limit = 10 }: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: ['pokemon-queries-infinite', { limit }],
    queryFn: async ({ pageParam = 0 }) => {
      // Return mock data for demo
      const queries = mockPokemonQueries.slice(pageParam, pageParam + limit);
      return {
        queries,
        pagination: {
          limit,
          offset: pageParam,
          total: mockPokemonQueries.length,
          hasMore: pageParam + limit < mockPokemonQueries.length
        }
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => 
      lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
    staleTime: 30_000,
  });
}

export function usePokemonQuery(callSid: string) {
  return useQuery({
    queryKey: queryKeys.pokemonQuery(callSid),
    queryFn: () => apiCall<PokemonQuery>(`/api/pokemon-queries/${callSid}`),
    enabled: !!callSid,
    staleTime: 60_000,
  });
}

export function usePokemonStats() {
  return useQuery({
    queryKey: queryKeys.pokemonStats(),
    queryFn: async (): Promise<PokemonQueryStats> => {
      // Return mock stats for demo
      return {
        stats: {
          totalCalls: 5,
          uniquePokemon: 5,
          totalDuration: 630, // sum of all durations
          averageDuration: 126, // 630/5
          topPokemon: [
            { name: 'Squirtle', count: 1 },
            { name: 'Bulbasaur', count: 1 },
            { name: 'Charmander', count: 1 },
            { name: 'Butterfree', count: 1 },
            { name: 'Pikachu', count: 1 }
          ],
          recentActivity: mockPokemonQueries.map(q => ({
            callSid: q.call_sid,
            timestamp: q.timestamp,
            pokemonCount: q.pokemon_names.length
          }))
        }
      };
    },
    staleTime: 60_000,
  });
}