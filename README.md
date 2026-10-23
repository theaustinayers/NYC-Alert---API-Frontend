# NYCAlert API Developer Portal

A responsive developer portal for `https://api.nycalert.ai`, styled to match the supplied NYCAlert logo. The browser frontend is dependency-free; Node.js serves the site and a same-origin read-only proxy.

## Run locally

Requires Node.js 18 or newer. No dependency installation is needed.

```powershell
node .\server.js
```

Visit `http://127.0.0.1:8080`.

Alternatively, run `npm.cmd start` in PowerShell or `npm start` in a POSIX shell.

The live OpenAPI contract is loaded through `/api-proxy/openapi.json`. The portal builds navigation and response schemas from the registered operations, and uses the local inventory if the live contract is unavailable.

## Features and safety

- Lists all operations from the live contract, including newly registered routes.
- Interactive forms for public GET routes, showing HTTP status, latency, selected safe response headers, and the actual response body.
- Incident filters use borough, category, status, and agency IDs fetched from the reference endpoints.
- SSE console parses default and named events, IDs, and heartbeat comments; includes pause/resume, history, and reconnects.
- Audience selection for `public`, `buff`, and `news`, synchronized between the audience page, REST reference, and SSE console. Changing selection never grants access.
- Public is the default feed without an audience or API key: `/v1/incidents` for REST and `/v1/incidents/stream` for SSE. News and Buff remain protected.
- Editorial queue is documented but neither proxied nor called; approval is not executable.
- No API credentials, arbitrary proxy targets, or non-GET requests are accepted by the proxy.
- The proxy allows only known public API routes and rate-limits each client IP to 60 requests per minute.

The API currently blocks browser CORS requests. The same-origin proxy is therefore required for the in-browser explorer and SSE console to work. Code samples still call the production API directly. The proxy does not expose editorial routes or accept user-supplied upstream URLs.

## SEO and social sharing

The canonical frontend URL is `https://api.nycalert.ai/`; the main NYC Alert website is `https://nycalert.ai/`. The initial HTML includes search descriptions, Open Graph and Twitter large-image cards, and Organization/WebSite/WebPage JSON-LD. Metadata is available without JavaScript. Hash-based documentation sections share the root canonical URL and are not separate sitemap entries.

The branded social image is `assets/nycalert-social.png` (1200 x 630). Regenerate it on Windows with `powershell -NoProfile -File .\scripts\generate-social-image.ps1`; no package installation is required. The server serves this image, `robots.txt`, and `sitemap.xml` directly. Deploy those files with the HTML and ensure crawlers can fetch them anonymously over HTTPS. The crawler policy excludes the interactive `/api-proxy/` routes, not API documentation.

Social platforms cache previews; after deploying an image change, refresh the platform's preview cache. Search indexing and preview updates are not immediate.

## Audience integration status

**Public access is anonymous by default.** The public selector (and an omitted audience) uses `/v1/incidents` and `/v1/incidents/stream` with no credential header. Both routes were verified to return HTTP 200 anonymously. The deployed `/v1/audiences/public/incidents` and `/v1/audiences/public/stream` currently return HTTP 404; the portal therefore does not send public requests to those paths.

**News and Buff execution remains locked.** No SSO provider or protected audience credentials are configured. Explicit `/api-proxy/v1/audiences/...` GETs remain blocked with HTTP 403 and `audience_auth_not_configured` before any upstream request. This includes unsupported explicit public-audience paths; public access uses the unscoped routes above. Supplied headers or edited URLs cannot unlock protected feeds. A rejected protected request never silently falls back to public.

The Audiences & access page defaults to Public, offers a public incident explorer and anonymous SSE, and documents the protected route previews. Switching audience clears event history so data from a prior selection is not displayed under a new audience.

Live OpenAPI declares `limit` (1–100, default 20) on audience incidents, `since_id` (nonnegative integer) on audience SSE, and an `authorization` header on both. This confirms the header name, not its value scheme. The exact token scheme, authorized response envelopes, replay semantics, heartbeat interval, rate limits, CORS, and audience-exclusion behavior still need authorized testing. The guide confirms `public`, `buff`, and `news`; it does not specify different delays, priorities, or field visibility for these roles.

To enable protected News and Buff execution in a future implementation:

1. Choose and configure an identity provider and secure session handling.
2. Verify sessions and audience entitlements on **every** backend REST/SSE connection.
3. Verify credential transport against the API and configure matching audience secrets server-side. The guide suggests `NYCALERT_AUDIENCE`, `NYCALERT_AUTH_HEADER_NAME`, and `NYCALERT_AUTH_HEADER_VALUE`; these are documentation placeholders, not an implemented configuration switch.
4. Test valid/invalid credentials for all audiences, reject cross-audience access, and verify held/rejected events are excluded in a safe environment.
5. Validate response shapes in an adapter before adding specialized cards or client-side filters. Keep private data out of cross-user caches and logs.
6. Replace the intentional server-side lock only after those checks; preserve non-buffering SSE forwarding, disconnect handling, ID deduplication, heartbeat reporting, and reconnect isolation.

Do not put tokens in browser inputs, JavaScript, localStorage, URL parameters, or copied examples. Native browser EventSource cannot add arbitrary headers; use an authenticated same-origin BFF. Publishing is autonomous and does not require a human approval button.

## Validation

```powershell
node --test
node --check .\app.js
node --check .\server.js
```

`PORT` sets the listening port (default `8080`). The listener binds only to IPv4 loopback (`127.0.0.1`), never all network interfaces. The server rate-limits by socket IP. Set `TRUST_PROXY=1` only behind a trusted reverse proxy that overwrites `X-Forwarded-For`; otherwise callers can spoof that header.

## Deploy

Run the Node app as an application service behind a TLS-enabled reverse proxy. Cloudflare can provide DNS, TLS, and edge protections in front of the Node service. A static-only hosting plan cannot run the proxy as-is; use a backend service or adapt the same route allowlist and rate limit to a serverless function.

The reverse proxy must reach the Node service at `127.0.0.1:8080` on the same host/network namespace. Remote hosts and separate container network namespaces cannot reach this loopback-only listener directly. Localhost binding is committed in the repository; do not patch `server.js` on the production server after updates.

Example NGINX configuration:

```nginx
server {
    listen 443 ssl;
    server_name api.nycalert.ai;
    # Configure ssl_certificate and ssl_certificate_key for your TLS provider.

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

When using `TRUST_PROXY=1`, configure the ingress to overwrite forwarded client-IP headers. `proxy_buffering off` preserves live SSE delivery.

## API contract boundaries

The OpenAPI specification is authoritative; the local endpoint inventory is a fallback. The site does not invent response fields or auth requirements. Alarm-box lookup requires a four-character `box` and supports an optional `borough`; it does not enumerate alarm boxes. The editorial queue may be privileged and is not called anonymously. No editorial approval mutation is sent by the portal.
