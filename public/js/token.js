// The server's secret for this page, put in a meta tag when index.html is served (see server/core/auth.js).
export const TOKEN = (typeof document !== 'undefined' && document.querySelector('meta[name="jade-token"]')?.content) || '';
