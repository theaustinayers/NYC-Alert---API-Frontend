# NYCAlert API Developer Portal

A responsive developer portal for `https://api.nycalert.ai`, styled to match the supplied NYCAlert logo. The browser frontend is dependency-free; Node.js serves the site and a same-origin read-only proxy.

## Run locally

Requires Node.js 18 or newer. No dependency installation is needed.

```powershell
node .\server.js
```

Visit `http://localhost:8080`.

Alternatively, run `npm.cmd start` in PowerShell or `npm start` in a POSIX shell.

The live OpenAPI contract is loaded through `/api-proxy/openapi.json`. The portal builds navigation and response schemas from the registered operations, and uses the local inventory if the live contract is unavailable.

## Features and safety

- Lists all operations from the live contract, including newly registered routes.
- Interactive forms for public GET routes, showing HTTP status, latency, selected safe response headers, and the actual response body.
- Incident filters use borough, category, status, and agency IDs fetched from the reference endpoints.
- SSE console parses default and named events, IDs, and heartbeat comments; includes pause/resume, history, and reconnects.
- Audience selection for `public`, `buff`, and `news`, synchronized between the audience page, REST reference, and SSE console. Changing selection never grants access.
- The audience UI and docs follow the 2026-10-22 integration guide. Both audience endpoints are registered in live OpenAPI; the anonymous legacy API is not the authenticated audience API.
- Editorial queue is documented but neither proxied nor called; approval is not executable.
- No API credentials, arbitrary proxy targets, or non-GET requests are accepted by the proxy.
- The proxy allows only known public API routes and rate-limits each client IP to 60 requests per minute.

The API currently blocks browser CORS requests. The same-origin proxy is therefore required for the in-browser explorer and SSE console to work. Code samples still call the production API directly. The proxy does not expose editorial routes or accept user-supplied upstream URLs.

## Audience integration status

**Audience execution is intentionally locked**, as requested. No SSO provider or audience credentials are configured. Every `/api-proxy/v1/audiences/...` GET returns HTTP 403 with `audience_auth_not_configured` before any upstream request, even for `public`. Other methods are rejected. Supplying headers or changing the audience URL cannot unlock access.

The Audiences & access page documents audience-specific REST and SSE paths and verification status. The SSE source defaults to the selected audience in locked mode; the separately labelled **Legacy public stream (not audience-scoped)** remains available for compatibility. It never silently substitutes for an audience stream.

Live OpenAPI declares `limit` (1–100, default 20) on audience incidents, `since_id` (nonnegative integer) on audience SSE, and an `authorization` header on both. This confirms the header name, not its value scheme. The exact token scheme, authorized response envelopes, replay semantics, heartbeat interval, rate limits, CORS, and audience-exclusion behavior still need authorized testing. The guide confirms `public`, `buff`, and `news`; it does not specify different delays, priorities, or field visibility for these roles.

To enable protected execution in a future implementation:

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

`PORT` sets the listening port (default `8080`). The server rate-limits by socket IP. Set `TRUST_PROXY=1` only behind a trusted reverse proxy that overwrites `X-Forwarded-For`; otherwise callers can spoof that header.

## Deploy

Run the Node app as an application service behind a TLS-enabled reverse proxy. Cloudflare can provide DNS, TLS, and edge protections in front of the Node service. A static-only hosting plan cannot run the proxy as-is; use a backend service or adapt the same route allowlist and rate limit to a serverless function.

Example NGINX configuration:

```nginx
server {
    listen 443 ssl;
    server_name developers.nycalert.ai;
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
