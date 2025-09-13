import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCall } from '@/lib/api';
import type { Session, User } from '@/lib/types';
import { queryKeys } from '@/lib/queries';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);

  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => apiCall<Session>('/api/auth/session'),
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (session?.authenticated) {
      setUser({
        id: session.sessionId,
        phoneNumber: session.phoneNumber
      });
    } else {
      setUser(null);
    }
  }, [session]);

  const logout = async () => {
    try {
      await apiCall('/api/auth/logout', {
        method: 'POST',
      });
    } catch (error) {
      console.warn('Logout error:', error);
    } finally {
      setUser(null);
      queryClient.clear();
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}