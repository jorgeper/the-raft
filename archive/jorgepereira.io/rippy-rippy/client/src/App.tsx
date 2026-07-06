import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import AppHeader from './components/AppHeader';
import BottomNav from './components/BottomNav';
import Login from './pages/Login';
import NotAllowed from './pages/NotAllowed';
import Day from './pages/Day';
import Workouts from './pages/Workouts';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import LibraryBrowser from './pages/LibraryBrowser';
import ExerciseDetail from './pages/ExerciseDetail';

function Shell() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-10 text-center text-muted">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <div className="min-h-dvh pb-20">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 pt-4">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/not-allowed" element={<NotAllowed />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Day />} />
          <Route path="/workouts" element={<Workouts />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/library" element={<LibraryBrowser />} />
          <Route path="/settings/library/:name" element={<ExerciseDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
