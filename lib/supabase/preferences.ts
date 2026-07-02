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

export type AlertRecipient = {
  userId: string;
  email: string;
  preferredCounties: string[];
  preferredTrades: string[];
  minEngineersEstimateCents: number | null;
  maxEngineersEstimateCents: number | null;
  alertFrequency: 'instant' | 'daily' | 'weekly';
  lastDigestSentAt: string | null;
};

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

function resolveJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getActiveAlertRecipients(): Promise<AlertRecipient[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_preferences')
    .select(
      `
      user_id,
      preferred_counties,
      preferred_trades,
      min_engineers_estimate_cents,
      max_engineers_estimate_cents,
      alert_frequency,
      last_digest_sent_at,
      users (
        email
      )
    `,
    )
    .eq('email_alerts_enabled', true)
    .neq('alert_frequency', 'off');

  if (error) {
    throw new Error(`Failed to fetch active alert recipients: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => {
      const user = resolveJoin(row.users as { email: string } | { email: string }[] | null);
      if (!user) return null;

      return {
        userId: row.user_id,
        email: user.email,
        preferredCounties: row.preferred_counties ?? [],
        preferredTrades: row.preferred_trades ?? [],
        minEngineersEstimateCents: row.min_engineers_estimate_cents ?? null,
        maxEngineersEstimateCents: row.max_engineers_estimate_cents ?? null,
        alertFrequency: row.alert_frequency as 'instant' | 'daily' | 'weekly',
        lastDigestSentAt: row.last_digest_sent_at ?? null,
      };
    })
    .filter((row): row is AlertRecipient => row !== null);
}
