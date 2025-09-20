import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { loadSessionProfileFromServer } from '../../lib/server/session';
import { SessionProfileProvider } from '../../lib/session/profile-context';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const profile = await loadSessionProfileFromServer();
  if (!profile) {
    redirect('/');
  }

  return <SessionProfileProvider initialProfile={profile}>{children}</SessionProfileProvider>;
}
