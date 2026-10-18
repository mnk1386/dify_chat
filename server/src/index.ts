/**
 * Server entrypoint: loads env-configured DB, applies persisted admin settings,
 * bootstraps admin user and starts listening.
 */

import { loadConfig, runtimeSettings } from './config';
import { initDb, getSetting } from './db';
import { createApp } from './app';
import { bootstrapAdminFromEnv } from './services/auth';
import { logger, setLogLevel } from './utils/logger';

function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  initDb(cfg.databaseUrl);

  // Apply persisted admin overrides on top of env defaults (env wins only when no DB value exists).
  const overrides: Record<string, unknown> = {};
  const baseUrl = getSetting('dify_base_url');
  const apiKey = getSetting('dify_api_key');
  const timeout = getSetting('dify_timeout_ms');
  const appType = getSetting('dify_app_type');
  const maxUpload = getSetting('max_upload_size_mb');
  if (baseUrl) overrides.difyBaseUrl = baseUrl;
  if (apiKey) overrides.difyApiKey = apiKey;
  if (timeout) overrides.difyTimeoutMs = parseInt(timeout, 10);
  if (appType) overrides.difyAppType = appType;
  if (maxUpload) overrides.maxUploadSizeMb = parseInt(maxUpload, 10);
  if (Object.keys(overrides).length) runtimeSettings.update(overrides as never);

  bootstrapAdminFromEnv();

  const app = createApp();
  const port = runtimeSettings.get().appPort;
  app.listen(port, () => {
    logger.info('server started', { port, difyConfigured: Boolean(runtimeSettings.get().difyBaseUrl && runtimeSettings.get().difyApiKey) });
  });
}

main();
