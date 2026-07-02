import { createClient } from '@/lib/supabase/server';
import { getPreferences } from '@/lib/supabase/preferences';
import { PreferencesForm } from './PreferencesForm';

export const metadata = { title: 'PrimeIntel — Settings' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const prefs = user ? await getPreferences(user.id) : null;

  // Changes when saved prefs change → remounts PreferencesForm so
  // defaultValue is re-applied (uncontrolled inputs ignore prop updates)
  const formKey = [
    prefs?.alert_frequency ?? '',
    String(prefs?.email_alerts_enabled ?? ''),
    String(prefs?.min_engineers_estimate_cents ?? ''),
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

      <PreferencesForm key={formKey} prefs={prefs} userEmail={user?.email ?? ''} />
    </div>
  );
}
