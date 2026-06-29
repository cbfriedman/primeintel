import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { saveBid, unsaveBid } from '@/lib/supabase/saved-bids';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { bid_id, action } = body as { bid_id: string; action: 'save' | 'unsave' };

  if (!bid_id || !action) {
    return NextResponse.json(
      { ok: false, error: 'Missing bid_id or action' },
      { status: 400 },
    );
  }

  try {
    if (action === 'save') {
      await saveBid(user.id, user.email ?? '', bid_id);
    } else {
      await unsaveBid(user.id, bid_id);
    }
    return NextResponse.json({ ok: true, saved: action === 'save' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
