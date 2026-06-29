-- Auto-create public.users row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing auth users who don't have a public.users row
insert into public.users (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Indexes for saved bids and preferences lookups
create index if not exists idx_user_saved_bids_user_id
  on public.user_saved_bids(user_id);

create index if not exists idx_user_saved_bids_bid_id
  on public.user_saved_bids(bid_id);

create index if not exists idx_user_preferences_user_id
  on public.user_preferences(user_id);
