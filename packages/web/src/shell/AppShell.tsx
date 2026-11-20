import { CircleDollarSign, User, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatUsd } from '../format';
import type { NameMode } from '../lib/agents';
import { costToday, needsYou } from '../lib/board';
import { useHealth, useRuns, useTasks } from '../lib/queries';
import { navigate, useRoute, type Page } from '../lib/router';
import { useUi } from '../lib/store';
import { Segmented } from '../ui/Tabs';
import { NAV } from './nav';
import { ProjectPicker } from './ProjectPicker';

/**
 * Layout of every page (v2-01, v2-18): menu on the left with the connection card at the bottom,
 * a top bar with the project, name mode, today's cost and avatar. On phones the menu becomes a
 * tab bar at the bottom.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { page } = useRoute();
  const projectId = useUi((s) => s.projectId);
  const tasks = useTasks(projectId).data ?? [];
  const badge = needsYou(tasks);
  const running = tasks.filter((t) => t.active).length;

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only z-50 rounded-xl bg-surface px-4 py-3 font-bold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        İçeriğe geç
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface/70 px-4 py-7 backdrop-blur-md lg:flex">
        <Logo />
        <nav aria-label="Ana menü" className="mt-9 flex flex-col gap-1.5">
          {NAV.map((item) => (
            <SideLink
              key={item.page}
              item={item}
              active={page === item.page}
              badge={item.page === 'pano' ? badge : 0}
            />
          ))}
        </nav>
        <ConnectionCard running={running} />
      </aside>

      <div className="lg:pl-60">
        <TopBar />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[110rem] px-4 pb-28 outline-none sm:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>

      <MobileTabBar page={page} badge={badge} />
    </div>
  );
}

/** Blurred colour circles behind the page (peach top right, lilac bottom left, mint bottom). */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="absolute -top-40 -right-40 size-[38rem] rounded-full bg-blob-peach opacity-80 blur-[120px]" />
      <div className="absolute -bottom-48 -left-40 size-[30rem] rounded-full bg-blob-lilac opacity-90 blur-[110px]" />
      <div className="absolute right-1/4 -bottom-56 size-[30rem] rounded-full bg-blob-mint opacity-80 blur-[120px]" />
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="grid size-10 grid-cols-2 gap-1 rounded-xl bg-accent p-2 shadow-button"
      >
        <span className="rounded-[3px] bg-white/90" />
        <span className="rounded-[3px] bg-white/90" />
        <span className="rounded-[3px] bg-white/90" />
        <span className="rounded-[3px] bg-white/90" />
      </span>
      <span className="text-2xl font-extrabold tracking-tight">
        Squad<span className="text-accent">board</span>
      </span>
    </div>
  );
}

function SideLink({
  item,
  active,
  badge,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  badge: number;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => navigate({ page: item.page, task: null })}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-13 items-center gap-4 rounded-2xl px-4 text-lg font-semibold transition-colors ${
        active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:bg-surface/60 hover:text-ink'
      }`}
    >
      <Icon aria-hidden className={`size-6 ${active ? 'text-accent' : ''}`} />
      <span className="flex-1 text-left">{item.label}</span>
      {badge > 0 && (
        <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-warn-soft px-2 text-sm font-bold text-warn">
          {badge}
          <span className="sr-only"> iş seni bekliyor</span>
        </span>
      )}
    </button>
  );
}

/**
 * Bottom of the menu. Only shows what the app really knows: whether the local server answers and
 * how many agents run. (CLI version and plan are not reported by the API yet.)
 */
function ConnectionCard({ running }: { running: number }) {
  const health = useHealth();
  const ok = health.isSuccess;
  const label = health.isPending ? 'Bağlanıyor…' : ok ? 'Sunucu bağlı' : 'Sunucuya ulaşılamıyor';
  return (
    <div
      className="mt-auto rounded-card border border-line bg-surface p-4 shadow-card"
      aria-live="polite"
    >
      <p className="flex items-center gap-2.5 font-bold">
        <span
          aria-hidden
          className={`size-2.5 rounded-full ${health.isPending ? 'bg-idle' : ok ? 'bg-success' : 'bg-danger'}`}
        />
        {label}
      </p>
      <p className="mt-1 pl-5 text-sm text-muted">Claude Code · bu bilgisayarda</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-bold text-info">
        <Zap aria-hidden className="size-4" />
        {running > 0 ? `${running} ajan çalışıyor` : 'Boşta'}
      </p>
    </div>
  );
}

function TopBar() {
  return (
    <header className="mx-auto flex w-full max-w-[110rem] flex-wrap items-center gap-3 px-4 pt-5 pb-4 sm:px-8 lg:pt-7 lg:pb-6">
      <div className="flex w-full items-center justify-between gap-3 lg:hidden">
        <Logo />
        <CostPill compact />
      </div>
      <ProjectPicker />
      <div className="ml-auto flex items-center gap-3">
        <NameModeSwitch />
        <span className="hidden lg:contents">
          <CostPill />
          <Avatar />
        </span>
      </div>
    </header>
  );
}

function NameModeSwitch() {
  const mode = useUi((s) => s.nameMode);
  const setMode = useUi((s) => s.setNameMode);
  return (
    <Segmented<NameMode>
      label="İsim modu"
      value={mode}
      onChange={setMode}
      items={[
        { id: 'technical', label: 'Teknik' },
        { id: 'simple', label: 'Sade' },
      ]}
    />
  );
}

/** Real cost of the runs that started today, across projects. */
function CostPill({ compact = false }: { compact?: boolean }) {
  const runs = useRuns();
  const total = runs.data ? formatUsd(costToday(runs.data)) : '—';
  return (
    <span
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 font-bold shadow-card"
      title="Bugün başlayan çalıştırmaların gerçek maliyeti"
    >
      <CircleDollarSign aria-hidden className="size-5" />
      {!compact && <span>Bugün</span>}
      <span className="sr-only">{compact ? 'Bugünkü maliyet' : 'maliyet'}</span>
      <span className="font-mono">{total}</span>
    </span>
  );
}

function Avatar() {
  return (
    <span
      aria-hidden
      className="inline-flex size-12 items-center justify-center rounded-full bg-agent-test text-white shadow-card"
    >
      <User className="size-5" />
    </span>
  );
}

function MobileTabBar({ page, badge }: { page: Page; badge: number }) {
  return (
    <nav
      aria-label="Ana menü"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.page;
          return (
            <li key={item.page}>
              <button
                type="button"
                onClick={() => navigate({ page: item.page, task: null })}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs font-bold ${
                  active ? 'text-accent' : 'text-muted'
                }`}
              >
                <Icon aria-hidden className="size-6" />
                {item.label}
                {item.page === 'pano' && badge > 0 && (
                  <span className="absolute top-2 left-1/2 ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-warn-soft px-1 text-xs text-warn">
                    {badge}
                    <span className="sr-only"> iş seni bekliyor</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
