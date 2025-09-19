'use client';

import Link from 'next/link';
import { SignOutButton } from '../../../features/auth/SignOutButton';

export default function SellerDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Seller workspace</h1>
            <p className="mt-2 text-sm text-slate-600">
              Jump into your daily tasks. Start by exploring the community warehouse directory, then create and track orders.
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Find warehouses</h2>
          <p className="mt-2 flex-1 text-sm text-slate-600">
            Browse staking-backed warehouses, compare storage fees, and pick the best partner before drafting your next order.
          </p>
          <Link
            href="/warehouses"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            Browse directory
          </Link>
        </article>

        <article className="flex flex-col rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          <h2 className="text-lg font-semibold text-slate-700">Coming soon</h2>
          <p className="mt-2">
            Order analytics, insurance coverage guidance, and collaborative drafts will appear here as we expand the HaiGo seller toolkit.
          </p>
        </article>
      </section>
    </main>
  );
}
