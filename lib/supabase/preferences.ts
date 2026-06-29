import { createAdminClient } from './admin';

export type UserPreferences = {
  preferred_counties: string[];
  preferred_trades: string[];
  min_engineers_estimate_cents: number | null;
  max_engineers_estimate_cents: number | null;
  email_alerts_enabled: boolean;
  alert_frequency: 'instant' | 'daily' | 'weekly' | 'off';
};

export type PreferencesInput = Partial<UserPreferences>;

async function ensurePublicUser(userId: string, email: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('users')
    .upsert({ id: userId, email }, { onConflict: 'id' });
}

export async function getPreferences(
  userId: string,
): Promise<UserPreferences | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch preferences: ${error.message}`);
  }

  if (!data) return null;

  return {
    preferred_counties: data.preferred_counties ?? [],
    preferred_trades: data.preferred_trades ?? [],
    min_engineers_estimate_cents: data.min_engineers_estimate_cents ?? null,
    max_engineers_estimate_cents: data.max_engineers_estimate_cents ?? null,
    email_alerts_enabled: data.email_alerts_enabled ?? true,
    alert_frequency: data.alert_frequency ?? 'daily',
  };
}

export async function upsertPreferences(
  userId: string,
  email: string,
  input: PreferencesInput,
): Promise<void> {
  await ensurePublicUser(userId, email);

  const supabase = createAdminClient();

  const { error } = await supabase.from('user_preferences').upsert(
    {
      user_id: userId,
      ...input,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    throw new Error(`Failed to save preferences: ${error.message}`);
  }
}
