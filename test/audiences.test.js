"use strict";

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let server;
let base;

before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  base = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Test server did not become ready")), 10_000);
    server.once("error", reject);
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited: ${code}`));
    });
  });
});

after(() => server?.kill());

test("SEO and social metadata are present in server-rendered HTML", async () => {
  const html = await (await fetch(base)).text();
  assert.match(html, /<title>NYC Alert \| FDNY &amp; NYPD Incident API System<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/api\.nycalert\.ai\/"/);
  assert.match(html, /property="og:image" content="https:\/\/api\.nycalert\.ai\/assets\/nycalert-social\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="description" content="[^"]+SSE streaming[^"]+"/);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema["@context"], "https://schema.org");
  assert.equal(schema["@graph"].find((item) => item["@type"] === "Organization").url, "https://nycalert.ai/");
  const webpage = schema["@graph"].find((item) => item["@type"] === "WebPage");
  assert.equal(webpage.url, "https://api.nycalert.ai/");
  assert.equal(webpage.primaryImageOfPage.width, 1200);
});

test("social PNG is publicly served at exactly 1200 by 630 pixels", async () => {
  const url = `${base}/assets/nycalert-social.png`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const image = Buffer.from(await response.arrayBuffer());
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), image.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("crawler files advertise only the canonical document and exclude the proxy", async () => {
  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /text\/plain/);
  const policy = await robots.text();
  assert.match(policy, /Disallow: \/api-proxy\//);
  assert.match(policy, /Sitemap: https:\/\/api\.nycalert\.ai\/sitemap\.xml/);
  const sitemap = await fetch(`${base}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /application\/xml/);
  const xml = await sitemap.text();
  assert.match(xml, /<loc>https:\/\/api\.nycalert\.ai\/<\/loc>/);
  assert.equal((xml.match(/<loc>/g) || []).length, 1);
});

for (const audience of ["public", "buff", "news", "unknown"]) {
  for (const resource of ["incidents", "stream"]) {
    test(`explicit audience path ${audience} ${resource} stays locked regardless of supplied credentials`, async () => {
      const response = await fetch(`${base}/api-proxy/v1/audiences/${audience}/${resource}?limit=20`, {
        headers: { Authorization: "not-a-real-token", "X-Audience": "news" }
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.code, "audience_auth_not_configured");
      assert.match(body.message, /No upstream request was made/);
      assert.ok(!JSON.stringify(body).includes("not-a-real-token"));
    });
  }
}

test("audience mutations and editorial reads remain blocked", async () => {
  assert.equal((await fetch(`${base}/api-proxy/v1/audiences/news/incidents`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/api-proxy/v1/editorial/queue`)).status, 403);
});

test("portal serves audience controls without credentials", async () => {
  const response = await fetch(base);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /id="audience-select"/);
  assert.match(html, /id="sse-audience"/);
  assert.match(html, /id="audience-open-feed"/);
  assert.match(html, /Public is the default feed with no API key required/);
  assert.ok(!html.includes('name="authorization"'));
});

function loadClient(fields = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\binit\(\);\s*$/, "");
  const context = vm.createContext({
    window: { location: { origin: "http://localhost:8080" } },
    document: { querySelector: (selector) => fields[selector] },
    URL, URLSearchParams, console, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout
  });
  vm.runInContext(source, context);
  return context;
}

test("audience stream URLs never include legacy type filters", () => {
  const context = loadClient({
    "#sse-audience": { value: "news" },
    "#sse-since": { value: "42" },
    "#sse-type": { value: "incident.created" }
  });
  const url = new URL(vm.runInContext("streamUrl()", context));
  assert.equal(url.pathname, "/api-proxy/v1/audiences/news/stream");
  assert.equal(url.searchParams.get("since_id"), "42");
  assert.equal(url.searchParams.has("type"), false);
});

test("legacy all keeps the proxy prefix and omits a type filter", () => {
  const context = loadClient({
    "#sse-audience": { value: "legacy" },
    "#sse-since": { value: "0" },
    "#sse-type": { value: "all" }
  });
  assert.equal(vm.runInContext("streamUrl()", context), "http://localhost:8080/api-proxy/v1/incidents/stream?since_id=0");
});

for (const audience of ["", "public"]) {
  test(`anonymous ${audience || "omitted"} audience uses the public SSE route`, () => {
    const context = loadClient({
      "#sse-audience": { value: audience },
      "#sse-since": { value: "0" },
      "#sse-type": { value: "all" }
    });
    assert.equal(vm.runInContext("streamUrl()", context), "http://localhost:8080/api-proxy/v1/incidents/stream?since_id=0");
    assert.equal(vm.runInContext(`feedPath(${JSON.stringify(audience)})`, context), "/v1/incidents");
  });
}

test("default public connect executes without credentials", async () => {
  const context = loadClient({
    "#sse-audience": { value: "public" },
    "#sse-since": { value: "0", setCustomValidity() {} },
    "#sse-type": { value: "all", setCustomValidity() {} },
    "#sse-toggle": { classList: { add() {} } }
  });
  let request;
  context.fetch = async (url, options) => {
    request = { url: url.toString(), options };
    return { ok: true, headers: { get: () => "text/event-stream" } };
  };
  vm.runInContext("setConnection = () => {}; consumeSse = async () => {}; startStream()", context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(request.url, "http://localhost:8080/api-proxy/v1/incidents/stream?since_id=0");
  assert.deepEqual(Object.keys(request.options.headers), ["Accept"]);
  assert.equal(vm.runInContext("streamRunning", context), true);
});

test("header parameters never become query parameters", () => {
  const context = loadClient();
  const url = vm.runInContext(`requestUrlFor(
    {path: "/v1/audiences/{audience}/incidents"},
    [{name: "audience", in: "path"}, {name: "authorization", in: "header"}, {name: "limit", in: "query"}],
    {elements: {namedItem(name) { return {value: {audience: "buff", authorization: "must-not-leak", limit: "20"}[name]}; }}}
  )`, context);
  assert.equal(url, "http://localhost:8080/api-proxy/v1/audiences/buff/incidents?limit=20");
});

test("audience examples use selected path and server-only authentication", () => {
  const context = loadClient();
  const examples = vm.runInContext(`selectedAudience = "buff"; audienceExamples({path: "/v1/audiences/{audience}/stream"})`, context);
  assert.match(examples.curl, /\/audiences\/buff\/stream/);
  assert.match(examples.javascript, /process\.env\.NYCALERT_AUTH_HEADER_VALUE/);
  assert.ok(!examples.javascript.includes("EventSource"));
  assert.ok(!examples.javascript.includes("Bearer"));
});

test("public examples use anonymous routes without credential setup", () => {
  const context = loadClient();
  for (const resource of ["incidents", "stream"]) {
    const examples = vm.runInContext(`audienceExamples({path: "/v1/audiences/{audience}/${resource}"})`, context);
    assert.match(examples.curl, /api\.nycalert\.ai\/v1\/incidents/);
    assert.ok(!JSON.stringify(examples).includes("AUTH_HEADER"));
    assert.ok(!JSON.stringify(examples).includes("/audiences/"));
  }
});

test("audience connect attempts do not execute even if invoked directly", () => {
  const context = loadClient({ "#sse-audience": { value: "news" } });
  let fetches = 0;
  context.fetch = () => { fetches++; };
  vm.runInContext("setConnection = () => {}; startStream()", context);
  assert.equal(fetches, 0);
  assert.equal(vm.runInContext("streamRunning", context), false);
});

test("reconnect uses the last received cursor rather than the initial replay input", async () => {
  const context = loadClient({
    "#sse-audience": { value: "legacy" },
    "#sse-since": { value: "0" },
    "#sse-type": { value: "all" }
  });
  let requested;
  context.fetch = async (url) => {
    requested = url.toString();
    return { ok: true, headers: { get: () => "text/event-stream" } };
  };
  vm.runInContext('setConnection = () => {}; consumeSse = async () => {}; streamRunning = true; latestEventId = "42"', context);
  await vm.runInContext("runStream()", context);
  assert.equal(new URL(requested).searchParams.get("since_id"), "42");
});

test("authorization failures stop reconnecting instead of silently falling back", async () => {
  const context = loadClient({
    "#sse-audience": { value: "legacy" },
    "#sse-since": { value: "0" },
    "#sse-type": { value: "" },
    "#sse-toggle": {}
  });
  const states = [];
  context.captureState = (...args) => states.push(args);
  context.fetch = async () => ({ ok: false, status: 403, text: async () => "Access denied" });
  vm.runInContext("setConnection = captureState; streamRunning = true", context);
  await vm.runInContext("runStream()", context);
  assert.equal(vm.runInContext("streamRunning", context), false);
  assert.equal(states.at(-1)[1], "Access denied");
  assert.equal(vm.runInContext("reconnectTimer", context), null);
});

test("SSE parser handles split CRLF, named events, deduplication and heartbeat comments", async () => {
  const context = loadClient();
  const captured = [];
  context.captureEvent = (event) => captured.push(event);
  vm.runInContext("renderEvent = captureEvent", context);
  const chunks = [
    "id: 12\r", "\nevent: incident.created\r\ndata: {\"incident\":", "{} }\r\n\r",
    "\nid: 12\nevent: incident.created\ndata: duplicate\n\n: keep-alive\n\n",
    "id: 13\nevent: heartbeat\ndata: ping\n\n"
  ];
  let index = 0;
  context.mockResponse = {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { value: Buffer.from(chunks[index++]), done: false }
          : { done: true }
      })
    }
  };
  await assert.rejects(vm.runInContext("consumeSse(mockResponse, {aborted: false})", context), /connection closed/);
  assert.equal(captured.length, 3);
  assert.equal(captured[0].event, "incident.created");
  assert.equal(captured[0].id, "12");
  assert.equal(captured[1].comment, "keep-alive");
  assert.equal(captured[2].event, "heartbeat");
  assert.equal(vm.runInContext("latestEventId", context), "13");
});
