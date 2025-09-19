import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { loadSessionProfileFromServer } from '../../../lib/server/session';

export default async function RegisterLayout({ children }: { children: ReactNode }) {
  const profile = await loadSessionProfileFromServer();
  if (profile) {
    const path = profile.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse';
    redirect(path);
  }

  return <>{children}</>;
}
