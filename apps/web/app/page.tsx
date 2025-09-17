import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Haigo Platform</h1>
      <p className="text-center text-muted-foreground max-w-xl">
        Welcome to the Haigo monorepo. This placeholder screen validates that the Next.js
        App Router is wired up while product surfaces are designed.
      </p>
      <div className="flex items-center gap-4">
        <Link className="underline" href="/docs">Documentation</Link>
        <Link className="underline" href="https://github.com/aptos-labs">Aptos Resources</Link>
      </div>
    </main>
  );
}
