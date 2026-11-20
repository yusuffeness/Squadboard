import { CircleDollarSign, Clock, House, Settings, Users, type LucideIcon } from 'lucide-react';
import type { Page } from '../lib/router';

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

export const NAV: readonly NavItem[] = [
  { page: 'pano', label: 'Pano', icon: House },
  { page: 'ekip', label: 'Ekip', icon: Users },
  { page: 'gecmis', label: 'Geçmiş', icon: Clock },
  { page: 'harcama', label: 'Harcama', icon: CircleDollarSign },
  { page: 'ayarlar', label: 'Ayarlar', icon: Settings },
];
