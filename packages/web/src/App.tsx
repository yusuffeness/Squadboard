import { QueryClientProvider } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { createApi, readToken } from './api';
import { ApiContext, createQueryClient } from './lib/queries';
import { useRoute } from './lib/router';
import { BoardPage } from './pages/BoardPage';
import { ComingSoon } from './pages/ComingSoon';
import { AppShell } from './shell/AppShell';
import { EmptyState } from './ui/EmptyState';

export function App() {
  // Read once: the token stays in memory (and in the address bar it came from).
  const [api] = useState(() => {
    const token = readToken();
    return token ? createApi(token) : null;
  });
  const [client] = useState(createQueryClient);

  if (!api) return <MissingToken />;
  return (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}>
        <AppShell>
          <Pages />
        </AppShell>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}

function Pages() {
  const { page } = useRoute();
  return page === 'pano' ? <BoardPage /> : <ComingSoon page={page} />;
}

function MissingToken() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4">
      <div className="w-full rounded-[2rem] border border-line bg-surface p-6 shadow-card">
        <EmptyState icon={KeyRound} title="Oturum anahtarı yok" size="lg">
          Bu sayfayı terminalde <code className="font-mono text-ink">squadboard</code> komutunun
          yazdığı bağlantıyla aç. Sonu <code className="font-mono text-ink">#token=…</code> ile
          biter.
        </EmptyState>
      </div>
    </main>
  );
}
