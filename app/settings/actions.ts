'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { upsertPreferences } from '@/lib/supabase/preferences';

export async function savePreferences(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const countiesRaw = (formData.get('preferred_counties') as string) ?? '';
  const tradesRaw = (formData.get('preferred_trades') as string) ?? '';
  const minEstimateRaw = formData.get('min_estimate') as string;
  const emailEnabled = formData.get('email_alerts_enabled') === 'on';
  const frequency = (formData.get('alert_frequency') as string) || 'daily';

  const preferred_counties = countiesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const preferred_trades = tradesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const min_engineers_estimate_cents = minEstimateRaw
    ? Math.round(parseFloat(minEstimateRaw) * 100)
    : null;

  await upsertPreferences(user.id, user.email ?? '', {
    preferred_counties,
    preferred_trades,
    min_engineers_estimate_cents,
    email_alerts_enabled: emailEnabled,
    alert_frequency: frequency as 'instant' | 'daily' | 'weekly' | 'off',
  });

  revalidatePath('/settings');
}
