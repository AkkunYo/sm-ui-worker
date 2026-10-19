// Single source of truth for the controller version shown in the UI.
// Must equal package.json "version" (asserted by tests/worker.test.mjs);
// scripts/build-agent.sh stamps the same version into the node agent.
export const APP_VERSION = '1.14.2-1';
export const PROTOCOL_VERSION = 2;
