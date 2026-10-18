"use strict";
/**
 * Server entrypoint: loads env-configured DB, applies persisted admin settings,
 * bootstraps admin user and starts listening.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const db_1 = require("./db");
const app_1 = require("./app");
const auth_1 = require("./services/auth");
const logger_1 = require("./utils/logger");
function main() {
    const cfg = (0, config_1.loadConfig)();
    (0, logger_1.setLogLevel)(cfg.logLevel);
    (0, db_1.initDb)(cfg.databaseUrl);
    // Apply persisted admin overrides on top of env defaults (env wins only when no DB value exists).
    const overrides = {};
    const baseUrl = (0, db_1.getSetting)('dify_base_url');
    const apiKey = (0, db_1.getSetting)('dify_api_key');
    const timeout = (0, db_1.getSetting)('dify_timeout_ms');
    const appType = (0, db_1.getSetting)('dify_app_type');
    const maxUpload = (0, db_1.getSetting)('max_upload_size_mb');
    if (baseUrl)
        overrides.difyBaseUrl = baseUrl;
    if (apiKey)
        overrides.difyApiKey = apiKey;
    if (timeout)
        overrides.difyTimeoutMs = parseInt(timeout, 10);
    if (appType)
        overrides.difyAppType = appType;
    if (maxUpload)
        overrides.maxUploadSizeMb = parseInt(maxUpload, 10);
    if (Object.keys(overrides).length)
        config_1.runtimeSettings.update(overrides);
    (0, auth_1.bootstrapAdminFromEnv)();
    const app = (0, app_1.createApp)();
    const port = config_1.runtimeSettings.get().appPort;
    app.listen(port, () => {
        logger_1.logger.info('server started', { port, difyConfigured: Boolean(config_1.runtimeSettings.get().difyBaseUrl && config_1.runtimeSettings.get().difyApiKey) });
    });
}
main();
//# sourceMappingURL=index.js.map