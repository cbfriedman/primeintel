import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/actions/auth';

export const metadata = { title: 'PrimeIntel — Bid Feed' };

export default async function BidsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="font-semibold text-zinc-900 text-sm tracking-tight">
              PrimeIntel
            </span>
            <nav className="flex items-center gap-6">
              <Link
                href="/bids"
                className="text-sm font-medium text-zinc-900"
              >
                Bid Feed
              </Link>
              <Link
                href="/settings"
                className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <span className="text-xs text-zinc-400">{user.email}</span>
            )}
            <Link
              href="/admin/review"
              className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Admin →
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
