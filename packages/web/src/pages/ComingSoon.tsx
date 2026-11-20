import { Sparkles } from 'lucide-react';
import { NAV } from '../shell/nav';
import type { Page } from '../lib/router';
import { EmptyState } from '../ui/EmptyState';

const LINES: Partial<Record<Page, string>> = {
  ekip: 'Ajanlarını açıp kapatacağın, talimatlarını düzenleyeceğin yer.',
  gecmis: 'Biten işlerin, kararların ve birleştirmelerin listesi.',
  harcama: 'Günlük ve iş başına harcadığın kredi.',
  ayarlar: 'Proje, model ve onay ayarları.',
};

/** Pages whose content comes in later stages: the menu and route work, the page says so. */
export function ComingSoon({ page }: { page: Page }) {
  const item = NAV.find((n) => n.page === page);
  const title = item?.label ?? '';
  const Icon = item?.icon ?? Sparkles;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-2 text-lg text-muted">{LINES[page]}</p>
      </div>
      <EmptyState icon={Icon} title="Yakında" size="lg">
        Bu sayfa üzerinde çalışıyoruz. Şimdilik Pano'dan devam edebilirsin.
      </EmptyState>
    </div>
  );
}
