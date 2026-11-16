// Which setting names hold a secret. Kept on its own so provider.js and redact.js can both use it without importing each other.
/** Names of settings whose value is a secret (a key, token, password, auth or headers). */
export const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|BEARER|AUTH|HEADERS/i;
