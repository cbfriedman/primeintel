import type { Bid } from '@/types/bid';
import { createAdminClient } from './admin';

async function ensurePublicUser(userId: string, email: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('users')
    .upsert({ id: userId, email }, { onConflict: 'id' });
}

export async function getSavedBidIds(userId: string): Promise<Set<string>> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_saved_bids')
    .select('bid_id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to fetch saved bid IDs: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.bid_id as string));
}

export async function getSavedBids(userId: string): Promise<Bid[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_saved_bids')
    .select('bids!inner(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch saved bids: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const bid = row.bids;
    return (Array.isArray(bid) ? bid[0] : bid) as Bid;
  });
}

export async function saveBid(
  userId: string,
  email: string,
  bidId: string,
): Promise<void> {
  await ensurePublicUser(userId, email);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('user_saved_bids')
    .upsert({ user_id: userId, bid_id: bidId }, { onConflict: 'user_id,bid_id' });

  if (error) {
    throw new Error(`Failed to save bid: ${error.message}`);
  }
}

export async function unsaveBid(userId: string, bidId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('user_saved_bids')
    .delete()
    .eq('user_id', userId)
    .eq('bid_id', bidId);

  if (error) {
    throw new Error(`Failed to unsave bid: ${error.message}`);
  }
}
