"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { once } = require("node:events");

const PORT = Number(process.env.PORT || 8080);
const API_ORIGIN = "https://api.nycalert.ai";
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_QUERY_LENGTH = 4096;
const rateLimits = new Map();
const ROOT = __dirname;

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/brand.css", ["brand.css", "text/css; charset=utf-8"]],
  ["/assets/nycalert-logo.png", ["assets/nycalert-logo.png", "image/png"]]
]);

const exactPublicRoutes = new Set([
  "/health",
  "/openapi.json",
  "/v1/boroughs",
  "/v1/categories",
  "/v1/agencies",
  "/v1/statuses",
  "/v1/incidents",
  "/v1/incidents/live",
  "/v1/incidents/stream",
  "/v1/search",
  "/v1/alarm-boxes"
]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function clientAddress(request) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function rateLimit(address, now = Date.now()) {
  const current = rateLimits.get(address);
  if (!current || now >= current.expiresAt) {
    rateLimits.set(address, { count: 1, expiresAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1, retryAfter: 0 };
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((current.expiresAt - now) / 1000))
    };
  }
  current.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - current.count, retryAfter: 0 };
}

function isAllowedPublicRoute(pathname) {
  if (exactPublicRoutes.has(pathname)) return true;
  const incidentMatch = pathname.match(/^\/v1\/incidents\/([^/]+)(?:\/(details|updates))?$/);
  return Boolean(incidentMatch && incidentMatch[1] !== "stream" && incidentMatch[1] !== "live");
}

function serveStatic(request, response, pathname) {
  const entry = staticFiles.get(pathname);
  if (!entry) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const [fileName, contentType] = entry;
  const filePath = path.join(ROOT, fileName);
  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch (error) {
    console.error(`Unable to read static asset ${fileName}.`, error);
    sendJson(response, 500, { error: "Unable to read site asset" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Cache-Control": fileName.endsWith(".png") ? "public, max-age=86400" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function proxyPublicGet(request, response, url, apiPath) {
  if (url.search.length > MAX_QUERY_LENGTH) {
    sendJson(response, 414, { error: "Query string is too long" });
    return;
  }
  const limit = rateLimit(clientAddress(request));
  response.setHeader("X-RateLimit-Limit", String(MAX_REQUESTS_PER_WINDOW));
  response.setHeader("X-RateLimit-Remaining", String(limit.remaining));
  if (!limit.allowed) {
    response.setHeader("Retry-After", String(limit.retryAfter));
    sendJson(response, 429, { error: "Portal rate limit exceeded. Retry after the indicated interval." });
    return;
  }

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const upstreamUrl = new URL(apiPath + url.search, API_ORIGIN);
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: request.headers.accept?.includes("text/event-stream")
          ? "text/event-stream"
          : "application/json"
      },
      signal: controller.signal,
      redirect: "error"
    });
    const responseHeaders = {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-RateLimit-Limit": String(MAX_REQUESTS_PER_WINDOW),
      "X-RateLimit-Remaining": String(limit.remaining)
    };
    for (const name of ["content-type", "cache-control", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    if (request.headers.accept?.includes("text/event-stream")) {
      responseHeaders["Cache-Control"] = "no-cache, no-transform";
      responseHeaders.Connection = "keep-alive";
      responseHeaders["X-Accel-Buffering"] = "no";
    }
    response.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) {
      response.end();
      return;
    }
    for await (const chunk of upstream.body) {
      if (!response.write(chunk)) {
        await Promise.race([once(response, "drain"), once(response, "close")]);
      }
      if (response.destroyed) break;
    }
    if (!response.destroyed) response.end();
  } catch (error) {
    if (controller.signal.aborted || response.destroyed) return;
    console.error(`Public API request failed for ${apiPath}.`, error);
    if (!response.headersSent) {
      sendJson(response, 502, { error: "The upstream API could not be reached", message: error.message });
    } else {
      response.destroy(error);
    }
  }
}

const server = http.createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url, "http://localhost");
  } catch {
    sendJson(response, 400, { error: "Invalid request URL" });
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const staticPath = staticFiles.has(url.pathname) ? url.pathname : null;
    if (staticPath) {
      serveStatic(request, response, staticPath);
      return;
    }
  }

  if (url.pathname.startsWith("/api-proxy/")) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Only GET requests are supported by the public proxy" });
      return;
    }
    const apiPath = url.pathname.slice("/api-proxy".length);
    if (apiPath.startsWith("/v1/audiences/")) {
      sendJson(response, 403, {
        error: "Audience access locked",
        code: "audience_auth_not_configured",
        message: "SSO, server-side audience entitlements, and verified audience credentials must be configured before audience requests are enabled. No upstream request was made."
      });
      return;
    }
    if (!isAllowedPublicRoute(apiPath)) {
      sendJson(response, 403, { error: "This API operation is not available through the public portal proxy" });
      return;
    }
    proxyPublicGet(request, response, url, apiPath);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [address, entry] of rateLimits) {
    if (entry.expiresAt <= now) rateLimits.delete(address);
  }
}, WINDOW_MS);
cleanupTimer.unref();

server.listen(PORT, () => {
  console.log(`NYCAlert API portal listening on http://localhost:${server.address().port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
