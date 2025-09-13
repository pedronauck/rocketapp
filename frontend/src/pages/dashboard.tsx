import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PokemonList } from '@/components/pokemon/pokemon-list';
import { PokemonStats } from '@/components/pokemon/pokemon-stats';
import { QueryDetails } from '@/components/pokemon/query-details';
import { useAuth } from '@/contexts/auth-context';
import { LogOut, User, Phone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { apiCall } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

export function Dashboard() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  
  // Mock user for development/demo purposes
  const displayUser = user || { 
    id: 'demo', 
    phoneNumber: '+1 (727) 515-7107', 
    name: 'Demo User' 
  };
  const [selectedCallSid, setSelectedCallSid] = useState<string | null>(null);
  const [isCreatingDemo, setIsCreatingDemo] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out successfully');
    } catch (error) {
      toast.error('Logout failed');
    }
  };

  const handleCreateDemoData = async () => {
    setIsCreatingDemo(true);
    try {
      await apiCall('/api/pokemon/seed-demo', {
        method: 'POST',
      });
      toast.success('Demo data created successfully!', {
        description: 'Showing Squirtle, Bulbasaur, Charmander, Butterfree, and Pikachu.',
      });
      // Invalidate Pokemon queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['pokemon-queries-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['pokemon-stats'] });
    } catch (error) {
      toast.error('Failed to create demo data', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsCreatingDemo(false);
    }
  };

  // Helper function to format phone number to show only last 4 digits
  const formatPhoneDisplay = (phoneNumber: string) => {
    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');
    // Return last 4 digits with formatting
    const lastFour = digits.slice(-4);
    return `•••• ${lastFour}`;
  };

  const handleViewDetails = (callSid: string) => {
    setSelectedCallSid(callSid);
  };

  const handleBackToList = () => {
    setSelectedCallSid(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center shadow-lg">
                <span className="text-primary-foreground font-bold text-lg">P</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-card-foreground bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                  Pokédex Call Center
                </h1>
                <p className="text-sm text-muted-foreground">Your Pokémon Query History</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {displayUser && (
              <div className="flex items-center space-x-3 text-sm">
                <div className="flex items-center space-x-1 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>Signed in as</span>
                </div>
                <div className="flex items-center space-x-1 font-medium text-card-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{formatPhoneDisplay(displayUser.phoneNumber)}</span>
                </div>
              </div>
            )}
            <Button 
              variant="secondary" 
              onClick={handleCreateDemoData} 
              size="sm"
              disabled={isCreatingDemo}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {isCreatingDemo ? 'Creating...' : 'Demo Data'}
            </Button>
            <Button variant="outline" onClick={handleLogout} size="sm">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {!selectedCallSid ? (
          <>
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Your Statistics
              </h2>
              <PokemonStats />
            </section>

            <section>
              <PokemonList onViewDetails={handleViewDetails} />
            </section>
          </>
        ) : (
          <section>
            <QueryDetails
              callSid={selectedCallSid}
              onBack={handleBackToList}
            />
          </section>
        )}
      </main>
    </div>
  );
}