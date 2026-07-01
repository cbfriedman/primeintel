import { createClient } from '@/lib/supabase/server';
import { getPreferences } from '@/lib/supabase/preferences';
import { savePreferences } from './actions';

export const metadata = { title: 'PrimeIntel — Settings' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const prefs = user ? await getPreferences(user.id) : null;

  const minEstimateDollars = prefs?.min_engineers_estimate_cents
    ? (prefs.min_engineers_estimate_cents / 100).toFixed(0)
    : '';

  // Forces remount after save — uncontrolled inputs (defaultValue) don't update on reconciliation
  const formKey = [
    prefs?.alert_frequency ?? '',
    prefs?.email_alerts_enabled ?? '',
    prefs?.min_engineers_estimate_cents ?? '',
    prefs?.preferred_counties.join(',') ?? '',
    prefs?.preferred_trades.join(',') ?? '',
  ].join('|');

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Alert Preferences</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Control which bids trigger email alerts.
        </p>
      </div>

      <form key={formKey} action={savePreferences} className="space-y-6">
        <div className="rounded-lg border border-zinc-200 bg-white px-6 py-5 space-y-5">

          {/* Counties */}
          <div>
            <label htmlFor="preferred_counties" className="block text-sm font-medium text-zinc-700 mb-1">
              Preferred Counties
            </label>
            <input
              id="preferred_counties"
              name="preferred_counties"
              type="text"
              defaultValue={prefs?.preferred_counties.join(', ') ?? ''}
              placeholder="Los Angeles, San Diego, Orange"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 transition-colors"
            />
            <p className="mt-1 text-xs text-zinc-400">Comma-separated. Leave blank for all counties.</p>
          </div>

          {/* Trades */}
          <div>
            <label htmlFor="preferred_trades" className="block text-sm font-medium text-zinc-700 mb-1">
              Preferred Trades
            </label>
            <input
              id="preferred_trades"
              name="preferred_trades"
              type="text"
              defaultValue={prefs?.preferred_trades.join(', ') ?? ''}
              placeholder="General Engineering, Grading, Paving"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 transition-colors"
            />
            <p className="mt-1 text-xs text-zinc-400">Comma-separated. Leave blank for all trades.</p>
          </div>

          {/* Min estimate */}
          <div>
            <label htmlFor="min_estimate" className="block text-sm font-medium text-zinc-700 mb-1">
              Minimum Engineers Estimate ($)
            </label>
            <input
              id="min_estimate"
              name="min_estimate"
              type="number"
              min="0"
              step="1000"
              defaultValue={minEstimateDollars}
              placeholder="500000"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 transition-colors"
            />
            <p className="mt-1 text-xs text-zinc-400">Only alert on bids at or above this value. Leave blank for no minimum.</p>
          </div>

          {/* Frequency */}
          <div>
            <label htmlFor="alert_frequency" className="block text-sm font-medium text-zinc-700 mb-1">
              Alert Frequency
            </label>
            <select
              id="alert_frequency"
              name="alert_frequency"
              defaultValue={prefs?.alert_frequency ?? 'daily'}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 transition-colors bg-white"
            >
              <option value="instant">Instant — as new bids are scraped</option>
              <option value="daily">Daily digest</option>
              <option value="weekly">Weekly digest</option>
              <option value="off">Off</option>
            </select>
          </div>

          {/* Email toggle */}
          <div className="flex items-center gap-3">
            <input
              id="email_alerts_enabled"
              name="email_alerts_enabled"
              type="checkbox"
              defaultChecked={prefs?.email_alerts_enabled ?? true}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
            />
            <label htmlFor="email_alerts_enabled" className="text-sm text-zinc-700">
              Receive email alerts
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
          >
            Save preferences
          </button>
          <p className="text-xs text-zinc-400">
            Email alerts will be sent to {user?.email}
          </p>
        </div>
      </form>
    </div>
  );
}
