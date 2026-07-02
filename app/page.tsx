import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'PrimeIntel — California Public Works Bid Intelligence',
  description: 'AI-powered bid intelligence for California public works contractors. Automated scraping, extraction, and alerts.',
};

const FEATURES = [
  {
    title: 'Automated Bid Scraping',
    description: 'New Caltrans bids are discovered and ingested automatically every two hours — no manual searching required.',
  },
  {
    title: 'AI-Extracted Bid Data',
    description: 'Claude and OpenAI independently extract key fields from every bid package: estimates, dates, bonding, DBE goals, and risk flags.',
  },
  {
    title: 'Confidence Scoring',
    description: 'Field-by-field comparison of two independent AI outputs surfaces conflicts and assigns a confidence score to every bid.',
  },
  {
    title: 'Instant Email Alerts',
    description: 'Set filters for county, trade, and minimum estimate. Get notified the moment a matching bid is processed.',
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect('/bids');

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Nav */}
      <header className="border-b border-zinc-200">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <span className="font-semibold text-zinc-900 tracking-tight">PrimeIntel</span>
          <Link
            href="/login"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24">
        <div className="max-w-2xl">
          <div className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 mb-6">
            California Public Works
          </div>
          <h1 className="text-4xl font-bold text-zinc-900 tracking-tight sm:text-5xl">
            Bid intelligence,<br />automated.
          </h1>
          <p className="mt-6 text-lg text-zinc-500 leading-relaxed">
            PrimeIntel scrapes Caltrans bid portals, extracts structured data with AI,
            scores confidence, and delivers matching bids straight to your inbox.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/login"
              className="rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
            >
              Get started
            </Link>
            <a
              href="https://ccop.dot.ca.gov/allProjects"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              View Caltrans source →
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-zinc-100 bg-zinc-50 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-zinc-400 mb-12">
            How it works
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-white p-6">
                <div className="text-xs font-semibold text-zinc-400 mb-3">0{i + 1}</div>
                <h3 className="text-sm font-semibold text-zinc-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200 px-6 py-6">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <span className="text-xs text-zinc-400">© 2026 PrimeIntel</span>
          <Link href="/login" className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
            Sign in
          </Link>
        </div>
      </footer>

    </div>
  );
}
