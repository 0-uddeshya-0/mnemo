-- App settings (singleton). Holds agent-exposure controls (§8.7) and future prefs.
CREATE TABLE IF NOT EXISTS app_settings (
  id   integer PRIMARY KEY DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT app_settings_singleton CHECK (id = 1)
);
INSERT INTO app_settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
