import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeToggle } from '@/components/theme-toggle';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/auth-context';
import { AuthGuard } from '@/components/auth/auth-guard';
import { AuthPage } from '@/pages/auth-page';
import { Dashboard } from '@/pages/dashboard';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-background">
          <div className="fixed top-4 right-4 z-50">
            <ThemeToggle />
          </div>

          <Routes>
            <Route 
              path="/" 
              element={
                <AuthGuard fallback={<Navigate to="/auth" replace />}>
                  <Dashboard />
                </AuthGuard>
              } 
            />
            <Route path="/auth" element={<AuthPage />} />
          </Routes>

          <Toaster richColors position="top-right" />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
