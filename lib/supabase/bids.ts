import type { Bid, BidDocument, BidRiskFlag } from "@/types/bid";
import type { BidDbExtractionStatus } from "@/types/extraction";

import { createAdminClient } from "./admin";

export type BidUpsertInput = {
  source_name: string;
  source_url: string;
  title: string;
  state?: string;
  scrape_run_id?: string | null;
  source_id?: string | null;
  description?: string | null;
  agency?: string | null;
  county?: string | null;
  city?: string | null;
  trade?: string | null;
  project_location?: string | null;
  bid_date?: string | null;
  prebid_meeting_at?: string | null;
  question_deadline_at?: string | null;
  engineers_estimate_cents?: number | null;
  license_requirements?: string | null;
  dbe_goal_percent?: number | null;
  bid_bond_percent?: number | null;
  payment_bond_required?: boolean | null;
  performance_bond_required?: boolean | null;
  liquidated_damages?: string | null;
  project_duration?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export type BidFilters = {
  county?: string;
  trade?: string;
  extraction_status?: BidDbExtractionStatus;
  manual_review_required?: boolean;
  upcoming_only?: boolean;
  expired_only?: boolean;
  limit?: number;
  offset?: number;
};

export async function upsertBid(input: BidUpsertInput): Promise<Bid> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bids")
    .upsert(input, { onConflict: "source_url" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert bid: ${error.message}`);
  }

  return data as Bid;
}

export async function getBids(
  filters: BidFilters = {},
): Promise<{ bids: Bid[]; total: number }> {
  const supabase = createAdminClient();

  const { county, trade, extraction_status, manual_review_required, upcoming_only, expired_only } = filters;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("bids")
    .select("*", { count: "exact" })
    .neq("source_name", "dev-test")
    .order("bid_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (county) query = query.eq("county", county);
  if (trade) query = query.eq("trade", trade);
  if (extraction_status) query = query.eq("extraction_status", extraction_status);
  if (manual_review_required !== undefined) {
    query = query.eq("manual_review_required", manual_review_required);
  }
  if (upcoming_only) {
    const today = new Date().toISOString().split("T")[0];
    query = query.or(`bid_date.gte.${today},bid_date.is.null`);
  }
  if (expired_only) {
    const today = new Date().toISOString().split("T")[0];
    query = query.lt("bid_date", today);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch bids: ${error.message}`);
  }

  return {
    bids: (data ?? []) as Bid[],
    total: count ?? 0,
  };
}

export async function getBidById(id: string): Promise<Bid | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bids")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to fetch bid: ${error.message}`);
  }

  return data as Bid;
}

export async function getBidDocuments(bidId: string): Promise<BidDocument[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bid_documents")
    .select("*")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch bid documents: ${error.message}`);
  }

  return (data ?? []) as BidDocument[];
}

export async function getBidRiskFlags(bidId: string): Promise<BidRiskFlag[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bid_risk_flags")
    .select("*")
    .eq("bid_id", bidId)
    .order("severity", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch bid risk flags: ${error.message}`);
  }

  return (data ?? []) as BidRiskFlag[];
}
