import { NextResponse } from "next/server";

import { getBidById } from "@/lib/supabase/bids";
import type { Bid } from "@/types/bid";

type BidSuccessResponse = {
  ok: true;
  bid: Bid;
};

type BidErrorResponse = {
  ok: false;
  error: string;
  details?: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const bid = await getBidById(id);

    if (!bid) {
      return NextResponse.json<BidErrorResponse>(
        { ok: false, error: "Bid not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<BidSuccessResponse>({ ok: true, bid });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";
    return NextResponse.json<BidErrorResponse>(
      { ok: false, error: "Failed to fetch bid.", details: message },
      { status: 500 },
    );
  }
}
