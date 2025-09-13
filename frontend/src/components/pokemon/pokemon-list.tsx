import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PokemonCard } from './pokemon-card';
import { SearchFilter } from './search-filter';
import { Loader2, RefreshCw } from 'lucide-react';
import { usePokemonQueriesInfinite } from '@/hooks/use-pokemon-queries';

interface PokemonListProps {
  onViewDetails?: (callSid: string) => void;
}

export function PokemonList({ onViewDetails }: PokemonListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = usePokemonQueriesInfinite({ limit: 12 });

  const allQueries = data?.pages.flatMap(page => page.queries) ?? [];
  
  const filteredQueries = searchTerm
    ? allQueries.filter(query =>
        query?.pokemon_names?.some(name => 
          name.toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : allQueries;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading your Pokemon queries...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="text-destructive">
          <p className="text-lg font-semibold">Failed to load Pokemon queries</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Something went wrong'}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    );
  }

  if (filteredQueries.length === 0 && !searchTerm) {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="text-muted-foreground">
          <p className="text-lg font-semibold">No Pokemon queries yet</p>
          <p className="text-sm">
            Make a call to start building your Pokemon query history!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Your Pokemon Queries</h2>
          <p className="text-muted-foreground">
            {filteredQueries.length} {filteredQueries.length === 1 ? 'query' : 'queries'}
            {searchTerm && ` matching "${searchTerm}"`}
          </p>
        </div>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          {isRefetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <SearchFilter
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        totalQueries={allQueries.length}
        filteredCount={filteredQueries.length}
      />

      {filteredQueries.length === 0 && searchTerm ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">
            No Pokemon queries found matching "{searchTerm}"
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredQueries.map((query) => (
            <PokemonCard
              key={query.call_sid}
              query={query}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      )}

      {hasNextPage && !searchTerm && (
        <div className="flex justify-center pt-6">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading more...
              </>
            ) : (
              'Load More'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}