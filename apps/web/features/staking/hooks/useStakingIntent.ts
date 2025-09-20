import { useQuery } from '@tanstack/react-query';
import { fetchStakingIntent } from '@/lib/api/staking';

export function useStakingIntent(address?: string) {
  return useQuery({
    queryKey: ['staking-intent', address],
    queryFn: () => fetchStakingIntent(address!),
    enabled: !!address
  });
}

