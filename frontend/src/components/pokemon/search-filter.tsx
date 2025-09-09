import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SearchFilterProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  totalQueries: number;
  filteredCount: number;
}

export function SearchFilter({
  searchTerm,
  onSearchChange,
  totalQueries,
  filteredCount,
}: SearchFilterProps) {
  const clearSearch = () => {
    onSearchChange('');
  };

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search Pokemon..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 pr-10"
        />
        {searchTerm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {searchTerm ? (
          <>
            <span>Showing</span>
            <Badge variant="secondary">{filteredCount}</Badge>
            <span>of</span>
            <Badge variant="outline">{totalQueries}</Badge>
            <span>queries</span>
          </>
        ) : (
          <>
            <Badge variant="outline">{totalQueries}</Badge>
            <span>total queries</span>
          </>
        )}
      </div>
    </div>
  );
}