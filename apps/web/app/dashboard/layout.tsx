import type { ReactNode } from 'react';
import { loadSessionProfileFromServer } from '../../lib/server/session';
import { SessionProfileProvider } from '../../lib/session/profile-context';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let profile = null;
  try {
    profile = await loadSessionProfileFromServer();
  } catch (error) {
    console.warn('[HaiGo] Failed to load dashboard session profile', error);
  }

  return <SessionProfileProvider initialProfile={profile}>{children}</SessionProfileProvider>;
}
