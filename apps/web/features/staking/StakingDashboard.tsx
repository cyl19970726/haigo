'use client';

import { useWalletContext } from '@/lib/wallet/context';
import { useStakingIntent } from './hooks/useStakingIntent';
import { useState } from 'react';
import { useStakingActions } from './useStakingActions';

export function StakingDashboard() {
  const { accountAddress } = useWalletContext();
  const { data, isLoading, error, refetch } = useStakingIntent(accountAddress);
  const { submitting, error: actionError, lastHash, stake, unstake, setStorageFee } = useStakingActions();
  const [amountApt, setAmountApt] = useState<number>(0.1);
  const [feeBps, setFeeBps] = useState<number>(25);

  if (!accountAddress) {
    return <div>Please connect your wallet to view staking.</div>;
  }
  if (isLoading) {
    return <div>Loading staking intent…</div>;
  }
  if (error) {
    return <div>Failed to load staking: {(error as Error).message}</div>;
  }
  if (!data) {
    return <div>No staking data yet.</div>;
  }
  return (
    <section aria-labelledby="staking-heading">
      <h2 id="staking-heading">Stake & Storage Fee</h2>
      <div>
        <div>
          <span>Staked Amount</span>
          <strong>{Number(data.stakedAmount).toLocaleString()}</strong>
        </div>
        <div>
          <span>Storage Fee</span>
          <strong>{data.feePerUnit} bps</strong>
        </div>
      </div>
      <div aria-live="polite" className="sr-only">Staking data loaded</div>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <label>
          Amount (APT)
          <input
            type="number"
            step="0.01"
            min={0}
            value={amountApt}
            onChange={(e) => setAmountApt(Number(e.target.value))}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={submitting} onClick={async () => { await stake(amountApt); void refetch(); }}>Stake</button>
          <button disabled={submitting} onClick={async () => { await unstake(amountApt); void refetch(); }}>Unstake</button>
        </div>

        <label>
          Storage Fee (bps)
          <input
            type="number"
            step="1"
            min={0}
            value={feeBps}
            onChange={(e) => setFeeBps(Number(e.target.value))}
          />
        </label>
        <button disabled={submitting} onClick={async () => { await setStorageFee(feeBps); void refetch(); }}>Set Storage Fee</button>

        <button onClick={() => refetch()}>Refresh</button>
        {submitting && <div aria-live="polite">Submitting transaction…</div>}
        {lastHash && <div>Txn: {lastHash}</div>}
        {actionError && <div role="alert">{actionError}</div>}
      </div>
    </section>
  );
}
