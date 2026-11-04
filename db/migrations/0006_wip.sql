-- wip: partial index on claims, not used yet
create index if not exists claims_live_created_idx on claims (live_id, created_at);
