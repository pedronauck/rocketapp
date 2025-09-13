import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Calendar, Phone, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { usePokemonQuery } from '@/hooks/use-pokemon-queries';
import { Loader2 } from 'lucide-react';

interface QueryDetailsProps {
  callSid: string;
  onBack?: () => void;
}

export function QueryDetails({ callSid, onBack }: QueryDetailsProps) {
  const { data: query, isLoading, isError, error } = usePokemonQuery(callSid);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading query details...</p>
        </div>
      </div>
    );
  }

  if (isError || !query) {
    return (
      <div className="space-y-4">
        {onBack && (
          <Button variant="outline" onClick={onBack} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to List
          </Button>
        )}
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-destructive space-y-2">
              <p className="text-lg font-semibold">Failed to load query details</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Query not found'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatPokemonName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  };

  return (
    <div className="space-y-6">
      {onBack && (
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to List
        </Button>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl text-card-foreground">
                {formatPokemonName(query.pokemonName)}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center">
                  <Calendar className="mr-1 h-4 w-4" />
                  {format(new Date(query.timestamp), 'PPP p')}
                </div>
                <div className="flex items-center">
                  <Phone className="mr-1 h-4 w-4" />
                  Call ID: {query.callSid.slice(-8)}
                </div>
              </div>
            </div>
            <Badge variant="secondary">
              Query #{query.id}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <Separator />
          
          {query.conversationSummary && (
            <div className="space-y-3">
              <div className="flex items-center">
                <MessageSquare className="mr-2 h-4 w-4 text-primary" />
                <h3 className="font-semibold text-card-foreground">Conversation Summary</h3>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {query.conversationSummary}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <h4 className="font-medium text-card-foreground">Query Information</h4>
              <div className="space-y-1 text-muted-foreground">
                <p><span className="font-medium">Pokemon:</span> {formatPokemonName(query.pokemonName)}</p>
                <p><span className="font-medium">Date:</span> {format(new Date(query.timestamp), 'PP')}</p>
                <p><span className="font-medium">Time:</span> {format(new Date(query.timestamp), 'p')}</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium text-card-foreground">Call Details</h4>
              <div className="space-y-1 text-muted-foreground">
                <p><span className="font-medium">Call SID:</span> {query.callSid}</p>
                <p><span className="font-medium">Query ID:</span> {query.id}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}