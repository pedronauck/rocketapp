import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { Calendar, MessageSquare, Clock, Zap, Shield, Droplets, Leaf, Flame, Bug, Target } from 'lucide-react';
import type { PokemonQuery } from '@/lib/types';

interface PokemonCardProps {
  query: PokemonQuery;
  onViewDetails?: (callSid: string) => void;
}

const pokemonTypeData = {
  squirtle: { 
    type: 'Water', 
    gradient: 'from-blue-400 via-blue-500 to-blue-600',
    icon: Droplets,
    stats: { hp: 44, attack: 48, defense: 65, speed: 43 }
  },
  bulbasaur: { 
    type: 'Grass', 
    gradient: 'from-green-400 via-green-500 to-green-600',
    icon: Leaf,
    stats: { hp: 45, attack: 49, defense: 49, speed: 45 }
  },
  charmander: { 
    type: 'Fire', 
    gradient: 'from-red-400 via-red-500 to-red-600',
    icon: Flame,
    stats: { hp: 39, attack: 52, defense: 43, speed: 65 }
  },
  butterfree: { 
    type: 'Bug', 
    gradient: 'from-purple-400 via-purple-500 to-purple-600',
    icon: Bug,
    stats: { hp: 60, attack: 45, defense: 50, speed: 70 }
  },
  pikachu: { 
    type: 'Electric', 
    gradient: 'from-yellow-400 via-yellow-500 to-yellow-600',
    icon: Zap,
    stats: { hp: 35, attack: 55, defense: 40, speed: 90 }
  }
};

export function PokemonCard({ query, onViewDetails }: PokemonCardProps) {
  const formatPokemonName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  };

  const handleViewDetails = () => {
    onViewDetails?.(query.call_sid);
  };

  const primaryPokemon = query.pokemon_names[0] || 'Unknown Pokemon';
  const pokemonKey = primaryPokemon.toLowerCase() as keyof typeof pokemonTypeData;
  const pokemonData = pokemonTypeData[pokemonKey] || {
    type: 'Normal',
    gradient: 'from-gray-400 via-gray-500 to-gray-600',
    icon: Target,
    stats: { hp: 50, attack: 50, defense: 50, speed: 50 }
  };

  const IconComponent = pokemonData.icon;
  const additionalCount = query.pokemon_names.length - 1;

  return (
    <Card className="group hover:shadow-xl transition-all duration-300 bg-card border-border overflow-hidden relative transform hover:-translate-y-1">
      <div className={`absolute inset-0 bg-gradient-to-br ${pokemonData.gradient} opacity-10`} />
      <div className="relative z-10">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${pokemonData.gradient} flex items-center justify-center shadow-lg`}>
                  <IconComponent className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-card-foreground">
                    {formatPokemonName(primaryPokemon)}
                  </h3>
                  <Badge 
                    variant="secondary" 
                    className={`text-xs bg-gradient-to-r ${pokemonData.gradient} text-white border-0 shadow-sm`}
                  >
                    {pokemonData.type}
                  </Badge>
                </div>
              </div>
              
              {additionalCount > 0 && (
                <div className="text-sm text-muted-foreground">
                  +{additionalCount} more Pokémon
                </div>
              )}
            </div>
            
            <div className="text-right space-y-1">
              <div className="flex items-center text-xs text-muted-foreground">
                <Calendar className="mr-1 h-3 w-3" />
                {formatDistanceToNow(new Date(query.timestamp * 1000), { addSuffix: true })}
              </div>
              <div className="flex items-center text-xs text-muted-foreground">
                <Clock className="mr-1 h-3 w-3" />
                {query.duration ? `${Math.round(query.duration / 60)}m` : '< 1m'}
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">HP</span>
                <span className="font-medium">{pokemonData.stats.hp}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className={`h-2 bg-gradient-to-r ${pokemonData.gradient} rounded-full transition-all duration-500`}
                  style={{ width: `${(pokemonData.stats.hp / 100) * 100}%` }}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Attack</span>
                <span className="font-medium">{pokemonData.stats.attack}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className={`h-2 bg-gradient-to-r ${pokemonData.gradient} rounded-full transition-all duration-500`}
                  style={{ width: `${(pokemonData.stats.attack / 100) * 100}%` }}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Defense</span>
                <span className="font-medium">{pokemonData.stats.defense}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className={`h-2 bg-gradient-to-r ${pokemonData.gradient} rounded-full transition-all duration-500`}
                  style={{ width: `${(pokemonData.stats.defense / 100) * 100}%` }}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Speed</span>
                <span className="font-medium">{pokemonData.stats.speed}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className={`h-2 bg-gradient-to-r ${pokemonData.gradient} rounded-full transition-all duration-500`}
                  style={{ width: `${(pokemonData.stats.speed / 100) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {query.pokemon_names.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Other Pokémon in this call:</p>
              <div className="flex flex-wrap gap-1">
                {query.pokemon_names.slice(1, 4).map((pokemon, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {formatPokemonName(pokemon)}
                  </Badge>
                ))}
                {query.pokemon_names.length > 4 && (
                  <Badge variant="outline" className="text-xs">
                    +{query.pokemon_names.length - 4}
                  </Badge>
                )}
              </div>
            </div>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleViewDetails}
            className="w-full group-hover:bg-primary/10 transition-all duration-300 border-2 hover:border-primary/50"
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            View Conversation Details
          </Button>
        </CardContent>
      </div>
    </Card>
  );
}