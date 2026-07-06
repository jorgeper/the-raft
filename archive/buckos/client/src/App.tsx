import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import NotAllowed from './pages/NotAllowed';
import ParentDashboard from './pages/ParentDashboard';
import KidDetail from './pages/KidDetail';
import KidHome from './pages/KidHome';
import type { ReactNode } from 'react';

function FullScreenLoader() {
  return (
    <main className="flex min-h-screen items-center justify-center" aria-busy="true">
      <p className="animate-pulse font-display text-2xl text-ink-faint">Buckos…</p>
    </main>
  );
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return user.role === 'parent' ? <ParentDashboard /> : <KidHome />;
}

function ParentOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'parent') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/not-allowed" element={<NotAllowed />} />
        <Route
          path="/kids/:id"
          element={
            <ParentOnly>
              <KidDetail />
            </ParentOnly>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
