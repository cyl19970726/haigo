import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { loadSessionProfileFromServer } from '../../lib/server/session';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const profile = await loadSessionProfileFromServer();
  if (!profile) {
    redirect('/');
  }

  return <>{children}</>;
}
