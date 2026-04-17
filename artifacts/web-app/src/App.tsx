import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { SessionProvider } from "@/contexts/SessionContext";
import Landing from "@/pages/Landing";
import AuthPage from "@/pages/AuthPage";
import AppPage from "@/pages/AppPage";
import SuperAdminPage from "@/pages/SuperAdminPage";
import LogicGamesPreviewPage from "@/pages/LogicGamesPreviewPage";
import ChronoBoardPage from "@/pages/ChronoBoardPage";
import AdminPage from "@/pages/AdminPage";
import TeacherPage from '@/pages/TeacherPage';
import TAPage from '@/pages/TAPage';
import ParentPage from '@/pages/ParentPage';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', textAlign: 'center' }}>
      <div>
        <div style={{ fontSize: 60, marginBottom: 20 }}>🌌</div>
        <h1 style={{ color: 'white', margin: '0 0 10px' }}>404 — Lost in the Universe</h1>
        <a href="/" style={{ color: '#3b82f6', fontSize: 16 }}>← Return to Logic Lords</a>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/app" component={AppPage} />
      <Route path="/chrono/board/:board" component={ChronoBoardPage} />
      <Route path="/superadmin" component={SuperAdminPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/teacher" component={TeacherPage} />
      <Route path="/ta" component={TAPage} />
      <Route path="/parent" component={ParentPage} />
      <Route path="/logic-preview" component={LogicGamesPreviewPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <SessionProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </SessionProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
