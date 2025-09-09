export const queryKeys = {
  session: ['session'],
  pokemonQueries: (page?: number, limit?: number) => 
    ['pokemon-queries', { page, limit }],
  pokemonQuery: (callSid: string) => 
    ['pokemon-query', callSid],
  pokemonStats: () => 
    ['pokemon-stats'],
} as const;