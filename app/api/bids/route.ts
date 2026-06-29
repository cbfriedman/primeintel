import { NextResponse } from "next/server";

import { getBids } from "@/lib/supabase/bids";
import type { Bid } from "@/types/bid";
import type { BidDbExtractionStatus } from "@/types/extraction";

export const dynamic = "force-dynamic";

const VALID_EXTRACTION_STATUSES = new Set<BidDbExtractionStatus>([
  "pending",
  "processing",
  "completed",
  "needs_review",
  "failed",
]);

type BidsSuccessResponse = {
  ok: true;
  bids: Bid[];
  total: number;
  limit: number;
  offset: number;
};

type BidsErrorResponse = {
  ok: false;
  error: string;
  details?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const county = searchParams.get("county") ?? undefined;
  const trade = searchParams.get("trade") ?? undefined;
  const rawStatus = searchParams.get("extraction_status");
  const rawReview = searchParams.get("manual_review_required");

  const limitParsed = parseInt(searchParams.get("limit") ?? "20", 10);
  const offsetParsed = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = isNaN(limitParsed) ? 20 : Math.min(Math.max(limitParsed, 1), 100);
  const offset = isNaN(offsetParsed) ? 0 : Math.max(offsetParsed, 0);

  let extraction_status: BidDbExtractionStatus | undefined;
  if (rawStatus !== null) {
    if (!VALID_EXTRACTION_STATUSES.has(rawStatus as BidDbExtractionStatus)) {
      return NextResponse.json<BidsErrorResponse>(
        { ok: false, error: `Invalid extraction_status: ${rawStatus}` },
        { status: 400 },
      );
    }
    extraction_status = rawStatus as BidDbExtractionStatus;
  }

  let manual_review_required: boolean | undefined;
  if (rawReview === "true") manual_review_required = true;
  else if (rawReview === "false") manual_review_required = false;

  try {
    const { bids, total } = await getBids({
      county,
      trade,
      extraction_status,
      manual_review_required,
      limit,
      offset,
    });

    return NextResponse.json<BidsSuccessResponse>({
      ok: true,
      bids,
      total,
      limit,
      offset,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";
    return NextResponse.json<BidsErrorResponse>(
      { ok: false, error: "Failed to fetch bids.", details: message },
      { status: 500 },
    );
  }
}
