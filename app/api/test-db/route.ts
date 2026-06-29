import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Bid } from "@/types/bid";

export const dynamic = "force-dynamic";

type TestDbSuccessResponse = {
  ok: true;
  message: string;
  inserted: Bid;
  recentBids: Bid[];
};

type TestDbErrorResponse = {
  ok: false;
  error: string;
  details?: string;
};

function isTestRouteEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_TEST_DB_ROUTE === "true"
  );
}

function buildSampleBid(): Pick<
  Bid,
  "source_name" | "source_id" | "source_url" | "title" | "state" | "county" | "trade"
> {
  const timestamp = Date.now();

  return {
    source_name: "dev-test",
    source_id: `dev-test-${timestamp}`,
    source_url: `https://example.com/dev-test/${timestamp}`,
    title: "Dev Test Bid",
    state: "CA",
    county: "Los Angeles",
    trade: "General Engineering",
  };
}

export async function GET() {
  if (!isTestRouteEnabled()) {
    return NextResponse.json<TestDbErrorResponse>(
      {
        ok: false,
        error:
          "This route is disabled. Use npm run dev, or set ENABLE_TEST_DB_ROUTE=true in .env.local for local testing.",
      },
      { status: 404 },
    );
  }

  try {
    const supabase = createAdminClient();
    const sampleBid = buildSampleBid();

    const { data: inserted, error: insertError } = await supabase
      .from("bids")
      .insert(sampleBid)
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json<TestDbErrorResponse>(
        {
          ok: false,
          error: "Failed to insert sample bid.",
          details: insertError.message,
        },
        { status: 500 },
      );
    }

    const { data: recentBids, error: selectError } = await supabase
      .from("bids")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (selectError) {
      return NextResponse.json<TestDbErrorResponse>(
        {
          ok: false,
          error: "Sample bid inserted, but failed to read recent bids.",
          details: selectError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json<TestDbSuccessResponse>({
      ok: true,
      message: "Database connection test succeeded.",
      inserted: inserted as Bid,
      recentBids: (recentBids ?? []) as Bid[],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error.";

    return NextResponse.json<TestDbErrorResponse>(
      {
        ok: false,
        error: "Database connection test failed.",
        details: message,
      },
      { status: 500 },
    );
  }
}
