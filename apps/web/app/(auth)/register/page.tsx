import { redirect } from 'next/navigation';
import { RegisterView } from '../../../features/registration/RegisterView';
import { loadSessionProfileFromServer, logoutSessionFromServer } from '../../../lib/server/session';

interface RegisterPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

const normalizeAddress = (value?: string | string[]): string | null => {
  if (!value) return null;
  const address = Array.isArray(value) ? value[0] : value;
  if (typeof address !== 'string') return null;
  const trimmed = address.trim().toLowerCase();
  return /^0x[0-9a-f]+$/.test(trimmed) ? trimmed : null;
};

const isForceEnabled = (value?: string | string[]) => {
  if (!value) return false;
  const flag = Array.isArray(value) ? value[0] : value;
  if (!flag) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const profile = await loadSessionProfileFromServer();
  const requestedAddress = normalizeAddress(searchParams?.address);
  const force = isForceEnabled(searchParams?.force);

  if (profile) {
    const normalizedProfileAddress = profile.address.toLowerCase();
    if (force && requestedAddress && normalizedProfileAddress !== requestedAddress) {
      await logoutSessionFromServer();
    } else {
      const path = profile.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse';
      redirect(path);
    }
  }

  return <RegisterView />;
}
