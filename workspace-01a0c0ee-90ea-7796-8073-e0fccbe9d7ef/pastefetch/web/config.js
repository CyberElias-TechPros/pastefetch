/* PasteFetch web app configuration.
 *
 * API_BASE — where the Cloudflare Worker lives.
 *   ''                          → same origin (single-deploy mode, or local proxy)
 *   'https://pastefetch.<your-subdomain>.workers.dev'
 *                               → when the web app is on Cloudflare Pages.
 *
 * When the API is unreachable the app degrades gracefully into demo mode
 * (sample data, amber pill) so the UI is always explorable.
 */
window.PASTEFETCH_CONFIG = {
  API_BASE: "",
};
