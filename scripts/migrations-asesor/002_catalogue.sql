-- Advisor-owned Happia snapshot and cross-instance daily refresh marker.
-- Contains public catalogue data only; never customer or conversation data.

CREATE TABLE IF NOT EXISTS happia_catalogue_snapshot (
  snapshot_key TEXT PRIMARY KEY CHECK (snapshot_key = 'all'),
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source = 'happia_api')
);

CREATE TABLE IF NOT EXISTS happia_catalogue_refresh (
  refresh_key TEXT PRIMARY KEY CHECK (refresh_key = 'all'),
  attempt_started_at TIMESTAMPTZ NOT NULL
);
