import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Zap, Calendar, Trophy } from 'lucide-react';
import { usePokemonStats } from '@/hooks/use-pokemon-queries';
import { format } from 'date-fns';

export function PokemonStats() {
  const { data: stats, isLoading } = usePokemonStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-4 bg-muted rounded w-3/4"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
              <div className="h-3 bg-muted rounded w-2/3"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const statCards = [
    {
      title: "Total Queries",
      value: stats.totalQueries,
      description: "Pokemon searched",
      icon: TrendingUp,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "Unique Pokemon",
      value: stats.uniquePokemon,
      description: "Different species",
      icon: Zap,
      color: "text-yellow-600 dark:text-yellow-400",
    },
    {
      title: "Last Query",
      value: stats.lastQueryDate 
        ? format(new Date(stats.lastQueryDate), 'MMM d') 
        : "Never",
      description: "Most recent search",
      icon: Calendar,
      color: "text-green-600 dark:text-green-400",
    },
    {
      title: "Favorite Type",
      value: stats.favoriteType || "Unknown",
      description: "Most searched",
      icon: Trophy,
      color: "text-purple-600 dark:text-purple-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <Card key={index} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <Icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-card-foreground">
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}