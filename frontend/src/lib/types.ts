export interface User {
  id: string;
  phoneNumber: string;
  name?: string;
}

export interface Session {
  authenticated: boolean;
  phoneNumber: string;
  sessionId: string;
}

export interface VerificationResponse {
  success: boolean;
  message: string;
  token: string;
  sessionId: string;
}

export interface PokemonQuery {
  call_sid: string;
  pokemon_names: string[];
  timestamp: number;
  duration?: number;
}

export interface PokemonQueryStats {
  stats: {
    totalCalls: number;
    uniquePokemon: number;
    totalDuration: number;
    averageDuration: number;
    topPokemon: Array<{ name: string; count: number }>;
    recentActivity: Array<{
      callSid: string;
      timestamp: number;
      pokemonCount: number;
    }>;
  };
}

export interface PaginatedResponse<T> {
  queries: T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}