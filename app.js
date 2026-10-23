"use strict";

const PUBLIC_API_BASE = "https://api.nycalert.ai";
const API_BASE = window.NYCALERT_API_BASE || `${window.location.origin}/api-proxy`;
const OPENAPI_URL = `${API_BASE}/openapi.json`;
const AUDIENCES = ["public", "buff", "news"];
const AUDIENCE_ACCESS_MESSAGE = "Audience access is locked until SSO, server-side audience entitlements, and verified API credentials are configured. Selecting an audience does not grant access.";
let selectedAudience = "public";

const endpointDefinitions = [
  { method: "GET", path: "/health", label: "Health check", description: "Check API availability.", section: "Operations" },
  { method: "GET", path: "/v1/boroughs", label: "List boroughs", description: "Get borough reference data.", section: "Reference data" },
  { method: "GET", path: "/v1/categories", label: "List categories", description: "Get supported incident categories.", section: "Reference data" },
  { method: "GET", path: "/v1/agencies", label: "List agencies", description: "Get incident agency reference data.", section: "Reference data" },
  { method: "GET", path: "/v1/statuses", label: "List statuses", description: "Get available incident statuses.", section: "Reference data" },
  { method: "GET", path: "/v1/incidents", label: "List incidents", description: "Filter and page through published incidents.", section: "Incidents" },
  { method: "GET", path: "/v1/incidents/live", label: "Live incidents", description: "Retrieve recent live incidents.", section: "Incidents" },
  { method: "GET", path: "/v1/incidents/stream", label: "Incident stream", description: "Stream published incidents using Server-Sent Events.", section: "Incidents" },
  { method: "GET", path: "/v1/incidents/{incident_id}", label: "Get incident", description: "Get a published incident by ID.", section: "Incidents" },
  { method: "GET", path: "/v1/incidents/{incident_id}/details", label: "Incident details", description: "Get additional incident details.", section: "Incidents" },
  { method: "GET", path: "/v1/incidents/{incident_id}/updates", label: "Incident updates", description: "Get an incident update timeline.", section: "Incidents" },
  { method: "GET", path: "/v1/search", label: "Search incidents", description: "Search published incidents by text.", section: "Search" },
  { method: "GET", path: "/v1/audiences/{audience}/incidents", label: "Audience incidents", description: "Published incidents for an authorized public, buff, or news audience.", section: "Audiences", audienceScoped: true },
  { method: "GET", path: "/v1/audiences/{audience}/stream", label: "Audience stream", description: "Authenticated audience-scoped SSE. Tokens remain on the backend.", section: "Audiences", audienceScoped: true },
  { method: "GET", path: "/v1/alarm-boxes", label: "FDNY alarm boxes", description: "Look up an FDNY alarm box.", section: "FDNY" },
  { method: "GET", path: "/v1/editorial/queue", label: "Editorial queue", description: "Editorial queue (potentially privileged; not executable here).", section: "Editorial", restricted: true },
  { method: "POST", path: "/v1/editorial/{incident_id}/approve", label: "Approve incident", description: "Advertised as HTTP 501; mutation is not available from this portal.", section: "Editorial", restricted: true }
];

const knownParameters = {
  "/v1/audiences/{audience}/incidents": [
    { name: "audience", in: "path", required: true, type: "string", enum: AUDIENCES, description: "Guide-confirmed audience identifier. Server authorization is required, including for public." },
    { name: "limit", type: "integer", default: 20, minimum: 1, maximum: 100, description: "Declared by live OpenAPI; authorized response shape still needs verification." },
    { name: "authorization", in: "header", type: "string", description: "Declared header in live OpenAPI. Exact value scheme is unverified; configured only on a trusted backend." }
  ],
  "/v1/audiences/{audience}/stream": [
    { name: "audience", in: "path", required: true, type: "string", enum: AUDIENCES, description: "Guide-confirmed audience identifier. Selection is not an entitlement." },
    { name: "since_id", type: "integer", minimum: 0, description: "Declared by live OpenAPI. Authorized replay and cross-audience behavior require verification." },
    { name: "authorization", in: "header", type: "string", description: "Declared header in live OpenAPI. No audience credential is accepted by the browser." }
  ],
  "/v1/incidents": [
    { name: "borough", description: "Filter by borough.", type: "string" },
    { name: "category", description: "Filter by incident category.", type: "string" },
    { name: "status", description: "Filter by status.", type: "string" },
    { name: "agency", description: "Filter by agency.", type: "string" },
    { name: "occurred_after", description: "Incidents occurring after this ISO 8601 datetime.", type: "string", format: "date-time" },
    { name: "occurred_before", description: "Incidents occurring before this ISO 8601 datetime.", type: "string", format: "date-time" },
    { name: "published_after", description: "Incidents published after this ISO 8601 datetime.", type: "string", format: "date-time" },
    { name: "limit", description: "Number of incidents to return (default 20).", type: "integer", default: 20, minimum: 1, maximum: 100 },
    { name: "offset", description: "Number of records to skip (default 0).", type: "integer", default: 0, minimum: 0 }
  ],
  "/v1/incidents/live": [
    { name: "since", description: "Return incidents since this ISO 8601 datetime.", type: "string", format: "date-time" }
  ],
  "/v1/incidents/stream": [
    { name: "since_id", description: "Replay events after this ID.", type: "integer", minimum: 0 },
    { name: "type", description: "Filter by event type. The contract does not enumerate accepted values.", type: "string", minLength: 1, maxLength: 100 }
  ],
  "/v1/incidents/{incident_id}": [{ name: "incident_id", description: "Incident identifier.", type: "string", in: "path", required: true }],
  "/v1/incidents/{incident_id}/details": [{ name: "incident_id", description: "Incident identifier.", type: "string", in: "path", required: true }],
  "/v1/incidents/{incident_id}/updates": [
    { name: "incident_id", description: "Incident identifier.", type: "string", in: "path", required: true },
    { name: "limit", description: "Maximum updates to return (default 100).", type: "integer", default: 100, minimum: 1, maximum: 500 }
  ],
  "/v1/search": [
    { name: "q", description: "Search terms (2–120 characters).", type: "string", required: true, minLength: 2, maxLength: 120 },
    { name: "limit", description: "Maximum search results (default 20).", type: "integer", default: 20, minimum: 1, maximum: 50 }
  ],
  "/v1/alarm-boxes": [
    { name: "box", description: "Four-character FDNY alarm box identifier.", type: "string", required: true, minLength: 4, maxLength: 4 },
    { name: "borough", description: "Optional borough filter. Accepted values depend on the API.", type: "string" }
  ],
  "/v1/editorial/{incident_id}/approve": [{ name: "incident_id", description: "Incident identifier.", type: "string", in: "path", required: true }]
};

const documentedParameters = (path) => knownParameters[path] || [];
let apiSpec = null;
let endpoints = [...endpointDefinitions];
let selectedEndpoint = null;
let currentPage = "overview";
let toastTimer;
let streamController = null;
let streamRunning = false;
let streamPaused = false;
let bufferedEvents = [];
let displayedEvents = 0;
let latestEventId = "";
let streamStartedAt = 0;
let droppedPausedEvents = 0;
let streamGeneration = 0;
let reconnectTimer = null;
const seenEventIds = new Set();
const referenceData = new Map();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character]);

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw error;
    showToast("Copied to clipboard");
  }
}

function methodBadge(method) {
  return `<span class="method method-${method.toLowerCase()}">${escapeHTML(method)}</span>`;
}

function renderEndpointRow(endpoint, index) {
  const id = `endpoint-${index}`;
  const available = endpoint.method === "GET" && !endpoint.restricted && !endpoint.audienceScoped;
  return `<a class="endpoint-row" href="#${id}" data-endpoint-index="${index}" aria-label="${escapeHTML(endpoint.method)} ${escapeHTML(endpoint.path)}">
    ${methodBadge(endpoint.method)}<code class="endpoint-path">${escapeHTML(endpoint.path)}</code>
    <span class="endpoint-description">${escapeHTML(endpoint.description)}${available ? "" : " · documentation only"}</span><span class="endpoint-chevron">→</span>
  </a>`;
}

function renderNavigation() {
  const groups = new Map();
  endpoints.forEach((endpoint, index) => {
    if (!groups.has(endpoint.section)) groups.set(endpoint.section, []);
    groups.get(endpoint.section).push({ endpoint, index });
  });
  const nav = $("#endpoint-nav");
  nav.innerHTML = [...groups.entries()].map(([section, items]) =>
    `<div class="endpoint-group-label">${escapeHTML(section.toUpperCase())}</div>${items.map(({ endpoint, index }) =>
      `<a href="#endpoint-${index}" class="nav-link endpoint-nav-link" data-endpoint-index="${index}"><span class="method-mini ${endpoint.method.toLowerCase()}">${escapeHTML(endpoint.method)}</span><span>${escapeHTML(endpoint.label)}</span></a>`
    ).join("")}`
  ).join("");
  $("#endpoint-count").textContent = String(endpoints.length);
  $("#stat-endpoints").textContent = String(endpoints.length);
}

function renderEndpointIndexes() {
  const content = endpoints.map(renderEndpointRow).join("");
  $("#overview-endpoints").innerHTML = content;
  $("#openapi-list").innerHTML = content;
}

function normalizeEndpoint(path, method, operation) {
  const known = endpointDefinitions.find((endpoint) => endpoint.path === path && endpoint.method === method.toUpperCase());
  return {
    ...(known || {
      method: method.toUpperCase(),
      path,
      label: operation.summary || path,
      description: operation.description || operation.summary || "Registered API operation.",
      section: "Additional operations"
    }),
    operation,
    parameters: operation.parameters || [],
    responses: operation.responses || {}
  };
}

async function loadOpenApi() {
  const status = $("#spec-status");
  const specMessage = $("#spec-message");
  try {
    const response = await fetch(OPENAPI_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`OpenAPI returned HTTP ${response.status}`);
    const spec = await response.json();
    if (!spec || typeof spec.paths !== "object" || !spec.info) {
      throw new Error("The OpenAPI response is not a valid document.");
    }
    apiSpec = spec;
    const discovered = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method.toLowerCase())) continue;
        discovered.push(normalizeEndpoint(path, method, operation));
      }
    }
    endpoints = discovered;
    $("#api-version").textContent = spec.info.version || "unknown";
    status.textContent = `Contract v${spec.info.version || "unknown"}`;
    status.title = `Loaded ${endpoints.length} operations from the live OpenAPI document`;
    specMessage.innerHTML = `<span>✓</span><p>Loaded OpenAPI v${escapeHTML(spec.info.version || "unknown")} from the live API. ${endpoints.length} registered operations are listed below.</p>`;
  } catch (error) {
    console.error("Unable to load the live OpenAPI document.", error);
    status.textContent = "Local contract · live unavailable";
    status.title = error.message;
    specMessage.innerHTML = `<span>!</span><p>The live specification could not be loaded: ${escapeHTML(error.message)}. Showing the local endpoint inventory; verify current details against the <a href="https://api.nycalert.ai/openapi.json" target="_blank" rel="noreferrer">live OpenAPI document</a>.</p>`;
  }
  renderNavigation();
  renderEndpointIndexes();
  if (selectedEndpoint !== null && currentPage === "detail") showEndpoint(selectedEndpoint);
}

function schemaForOperation(endpoint) {
  const response = endpoint.responses && endpoint.responses["200"];
  const schema = response?.content?.["application/json"]?.schema;
  if (!schema || Object.keys(schema).length === 0) return "Response schema not specified.";
  const resolved = resolveSchema(schema);
  return JSON.stringify(resolved, null, 2);
}

function resolveSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    const referenced = apiSpec?.components?.schemas?.[name];
    return referenced ? { [name]: resolveSchema(referenced) } : schema;
  }
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      result[key] = Object.fromEntries(Object.entries(value).map(([prop, child]) => [prop, resolveSchema(child)]));
    } else if (key === "items" || key === "allOf" || key === "anyOf" || key === "oneOf") {
      result[key] = Array.isArray(value) ? value.map(resolveSchema) : resolveSchema(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function operationParameters(endpoint) {
  if (endpoint.parameters?.length) {
    const fallbackParameters = documentedParameters(endpoint.path);
    return endpoint.parameters.map((parameter) => {
      const fallback = fallbackParameters.find((candidate) => candidate.name === parameter.name);
      return {
        name: parameter.name,
        in: parameter.in || "query",
        required: Boolean(parameter.required),
        description: parameter.description || fallback?.description || "",
        schema: { ...(fallback || {}), ...(parameter.schema || {}) }
      };
    });
  }
  return documentedParameters(endpoint.path).map((parameter) => ({
    name: parameter.name,
    in: parameter.in || "query",
    required: Boolean(parameter.required),
    description: parameter.description,
    schema: Object.fromEntries(Object.entries(parameter).filter(([key]) =>
      ["type", "format", "default", "minimum", "maximum", "minLength", "maxLength", "enum"].includes(key)
    ))
  }));
}

function constraintText(schema) {
  const constraints = [];
  if (schema.default !== undefined) constraints.push(`default ${schema.default}`);
  if (schema.minimum !== undefined) constraints.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) constraints.push(`max ${schema.maximum}`);
  if (schema.minLength !== undefined) constraints.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined) constraints.push(`max length ${schema.maxLength}`);
  if (schema.format) constraints.push(schema.format);
  if (schema.enum) constraints.push(`values ${schema.enum.join(", ")}`);
  return constraints.join(" · ");
}

function audienceOptions() {
  return AUDIENCES.map((audience) => `<option value="${audience}"${audience === selectedAudience ? " selected" : ""}>${audience === "public" ? "Public" : audience === "buff" ? "Buff" : "News"} (${audience})</option>`).join("");
}

function selectAudience(audience) {
  if (!AUDIENCES.includes(audience)) {
    showToast("Unknown audience. Choose public, buff, or news.");
    return;
  }
  if (streamRunning) stopStream();
  selectedAudience = audience;
  $("#audience-select").value = audience;
  $("#sse-audience").value = audience;
  const endpointAudience = $("#param-audience");
  if (endpointAudience) {
    endpointAudience.value = audience;
    endpointAudience.dispatchEvent(new Event("input", { bubbles: true }));
  }
  $("#audience-rest-url").textContent = `${PUBLIC_API_BASE}/v1/audiences/${audience}/incidents?limit=${$("#audience-limit").value || 20}`;
  $("#audience-stream-url").textContent = `${PUBLIC_API_BASE}/v1/audiences/${audience}/stream`;
  $("#selected-audience-info").textContent = `${audience} is a guide-confirmed audience ID. Its visibility rules are enforced by the API. This portal has no authenticated entitlement for it; no incident data is fetched or shared when you change selection.`;
  updateSseAudience();
}

function updateSseAudience() {
  const legacy = $("#sse-audience").value === "legacy";
  $("#sse-type").disabled = !legacy;
  $("#sse-type-help").textContent = legacy
    ? "Legacy stream: leave blank or enter “all” for unfiltered published events. This is not an audience selector."
    : "Audience streams use the selected audience path; OpenAPI declares no type filter. Access remains locked until authenticated backend authorization is implemented.";
  $("#sse-toggle").disabled = !legacy;
  $("#sse-access-note").textContent = legacy
    ? "Legacy compatibility mode uses /v1/incidents/stream. It is not an authenticated audience feed and does not substitute for audience authorization."
    : AUDIENCE_ACCESS_MESSAGE;
  $("#stream-last-id").textContent = "Last event ID: —";
  $("#stream-heartbeat").textContent = "Last heartbeat: —";
  bufferedEvents = [];
  displayedEvents = 0;
  droppedPausedEvents = 0;
  seenEventIds.clear();
  $("#event-count").textContent = "0 events";
  $("#event-feed").innerHTML = `<div class="empty-stream"><span>⌁</span><strong>${legacy ? "No events yet" : "Audience access locked"}</strong><p>${legacy ? "Connect to receive published events." : "No credentials are requested or stored in your browser."}</p></div>`;
  setConnection(legacy ? "disconnected" : "error", legacy ? "Disconnected" : "Audience access locked", legacy ? "Legacy compatibility mode" : "SSO and server credentials not configured");
}

function bindAudienceControls() {
  $("#audience-select").innerHTML = audienceOptions();
  $("#sse-audience").innerHTML = `${audienceOptions()}<option value="legacy">Legacy public stream (not audience-scoped)</option>`;
  $("#audience-select").addEventListener("change", (event) => selectAudience(event.target.value));
  $("#audience-limit").addEventListener("input", () => {
    $("#audience-rest-url").textContent = `${PUBLIC_API_BASE}/v1/audiences/${selectedAudience}/incidents?limit=${$("#audience-limit").value}`;
  });
  selectAudience(selectedAudience);
}

function audienceExamples(endpoint) {
  const resource = endpoint.path.endsWith("/stream") ? "stream" : "incidents";
  const url = `${PUBLIC_API_BASE}/v1/audiences/${selectedAudience}/${resource}`;
  const headerSetup = `const audience = process.env.NYCALERT_AUDIENCE;\nconst headerName = process.env.NYCALERT_AUTH_HEADER_NAME;\nconst headerValue = process.env.NYCALERT_AUTH_HEADER_VALUE;\nif (!["news", "buff", "public"].includes(audience || "") || !headerName || !headerValue || headerName.startsWith("REPLACE_") || headerValue.startsWith("REPLACE_")) {\n  throw new Error("Configure verified server-side authentication");\n}`;
  const request = `${headerSetup}\n// After validating the user's session AND entitlement to this audience:\nconst response = await fetch(\`https://api.nycalert.ai/v1/audiences/\${audience}/${resource}\`, {\n  headers: { [headerName]: headerValue, Accept: "${resource === "stream" ? "text/event-stream" : "application/json"}" },\n  cache: "no-store"\n});\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);`;
  const result = resource === "stream"
    ? `\nif (!response.body) throw new Error("Streaming body unavailable");\n// Preserve SSE framing when forwarding to the authenticated browser session.\nfor await (const chunk of response.body) process.stdout.write(chunk);`
    : `\nconst data = await response.json(); // Schema unspecified; validate before specialized rendering.`;
  const python = `# Server-only illustration; first verify session and audience entitlement.\nimport os\nimport requests\n\naudience = os.environ["NYCALERT_AUDIENCE"]\nif audience not in ("public", "buff", "news"):\n    raise ValueError("Invalid audience")\nheader_name = os.environ["NYCALERT_AUTH_HEADER_NAME"]\nheader_value = os.environ["NYCALERT_AUTH_HEADER_VALUE"]\nif not header_name or not header_value or header_name.startswith("REPLACE_") or header_value.startswith("REPLACE_"):\n    raise ValueError("Configure verified server-side authentication")\nwith requests.get(\n    f"https://api.nycalert.ai/v1/audiences/{audience}/${resource}",\n    headers={header_name: header_value, "Accept": "${resource === "stream" ? "text/event-stream" : "application/json"}"},\n    stream=${resource === "stream" ? "True" : "False"}, timeout=${resource === "stream" ? "(10, None)" : "30"}\n) as response:\n    response.raise_for_status()\n${resource === "stream" ? "    for line in response.iter_lines():\n        print(line)" : "    print(response.json())"}`;
  return {
    curl: `# Server-side terminal only. Configure verified header name/value securely.\n# The header's value scheme is NOT confirmed; do not assume Bearer.\ncurl ${resource === "stream" ? "-N" : "-sS"} --fail-with-body \\\n  -H "\${NYCALERT_AUTH_HEADER_NAME}: \${NYCALERT_AUTH_HEADER_VALUE}" \\\n  '${url}'`,
    javascript: request + result,
    typescript: "// Node.js server only; never bundle these environment values for browsers.\n" + request + result,
    python
  };
}

function paramInput(parameter, endpoint) {
  const schema = parameter.schema?.anyOf?.find((option) => option.type !== "null") || parameter.schema || {};
  const required = parameter.required ? "required" : "optional";
  if (parameter.in === "header") {
    return `<div class="param-field"><label><code>${escapeHTML(parameter.name)}</code><span class="param-required">header · server only</span></label><p class="field-hint">${escapeHTML(parameter.description || "Configured by an authenticated backend; never included in a URL.")}</p></div>`;
  }
  if (parameter.name === "audience" && endpoint.audienceScoped) {
    return `<div class="param-field"><label for="param-audience"><code>audience</code><span class="param-required is-required">required · path</span></label><select class="param-input" id="param-audience" name="audience">${audienceOptions()}</select><small>${escapeHTML(parameter.description)}</small></div>`;
  }
  const filterLabels = {
    borough: "Any borough",
    category: "Any category",
    status: "Any status",
    agency: "Any agency"
  };
  const canUseReferenceSelect = endpoint.path === "/v1/incidents" && Object.prototype.hasOwnProperty.call(filterLabels, parameter.name);
  if (canUseReferenceSelect) {
    const id = `param-${parameter.name}`;
    return `<div class="param-field">
      <label for="${id}"><code>${escapeHTML(parameter.name)}</code><span class="param-required">${required}</span></label>
      <select class="param-input reference-filter" id="${id}" name="${escapeHTML(parameter.name)}" data-filter="${escapeHTML(parameter.name)}">
        <option value="">${escapeHTML(filterLabels[parameter.name])}</option>
      </select>
      <small>${escapeHTML(parameter.description || "")} <span id="filter-help-${escapeHTML(parameter.name)}">Reference values use API IDs.</span></small>
    </div>`;
  }
  const type = schema.type === "integer" || schema.type === "number" ? "number" : "text";
  const inputType = schema.format === "date-time" ? "datetime-local" : type;
  const min = schema.minimum !== undefined ? `min="${escapeHTML(schema.minimum)}"` : "";
  const max = schema.maximum !== undefined ? `max="${escapeHTML(schema.maximum)}"` : "";
  const maxlength = schema.maxLength !== undefined ? `maxlength="${escapeHTML(schema.maxLength)}"` : "";
  const minlength = schema.minLength !== undefined ? `minlength="${escapeHTML(schema.minLength)}"` : "";
  const requiredAttr = parameter.required ? "required" : "";
  const defaultValue = schema.default !== undefined ? `value="${escapeHTML(schema.default)}"` : "";
  const placeholder = schema.default !== undefined ? `placeholder="${escapeHTML(schema.default)}"` : "placeholder=\"Optional\"";
  return `<div class="param-field">
    <label for="param-${escapeHTML(parameter.name)}"><code>${escapeHTML(parameter.name)}</code><span class="param-required ${parameter.required ? "is-required" : ""}">${required}</span></label>
    <input class="param-input" id="param-${escapeHTML(parameter.name)}" name="${escapeHTML(parameter.name)}" type="${inputType}" ${min} ${max} ${maxlength} ${minlength} ${requiredAttr} ${defaultValue} ${placeholder}>
    <small>${escapeHTML(parameter.description || "")}${constraintText(schema) ? ` <span>${escapeHTML(constraintText(schema))}</span>` : ""}</small>
  </div>`;
}

function showEndpoint(index) {
  const endpoint = endpoints[index];
  if (!endpoint) return;
  selectedEndpoint = index;
  currentPage = "detail";
  updateActiveNav();
  const params = operationParameters(endpoint);
  const canExecute = endpoint.method === "GET" && !endpoint.restricted && !endpoint.audienceScoped && !endpoint.path.endsWith("/stream");
  const hasPathParams = params.some((parameter) => parameter.in === "path");
  const examples = endpointExamples(endpoint, params);
  $("#detail-content").innerHTML = `
    <div class="eyebrow"><span class="eyebrow-line"></span> ${escapeHTML(endpoint.section.toUpperCase())}</div>
    <h1 class="page-title">${escapeHTML(endpoint.label)}</h1>
    <p class="page-lead">${escapeHTML(endpoint.description)}</p>
    <div class="operation-title">${methodBadge(endpoint.method)}<code>${escapeHTML(endpoint.path)}</code><span>${canExecute ? "Interactive" : "Documentation only"}</span></div>
    ${endpoint.audienceScoped ? `<div class="info-banner"><span>!</span><p><strong>Audience access locked.</strong> ${escapeHTML(AUDIENCE_ACCESS_MESSAGE)} <a href="#audiences" data-page="audiences">Audience information and verification status</a></p></div>` : ""}
    ${endpoint.restricted ? `<div class="info-banner"><span>!</span><p>${endpoint.method === "POST" ? "This operation is advertised as HTTP 501. No mutation is performed from this site." : "This endpoint may expose privileged editorial data. It is documented but cannot be called from this public portal."}</p></div>` : ""}
    ${endpoint.path.endsWith("/stream") ? `<div class="info-banner"><span>i</span><p>For a live connection, use the <a href="#sse" data-page="sse">SSE developer console</a>. The event response schema is unspecified; event types are not enumerated by the contract.</p></div>` : ""}
    <h2>Parameters</h2>
    ${params.length ? `<form id="request-form" class="request-form" novalidate>
      <div class="parameter-grid">${params.map((parameter) => paramInput(parameter, endpoint)).join("") || `<p class="muted">No parameters are declared by OpenAPI.</p>`}</div>
      ${hasPathParams ? `<p class="field-hint">Path parameters are encoded safely as part of the request URL.</p>` : ""}
      ${canExecute ? `<div class="request-actions"><button class="button button-primary" type="submit">Send request <span>→</span></button><button class="button button-secondary" type="button" id="copy-request">Copy request URL</button></div>` : ""}
    </form>` : `<p class="muted">This operation has no parameters.</p>${canExecute ? `<div class="request-actions"><button class="button button-primary" id="send-no-param">Send request <span>→</span></button><button class="button button-secondary" id="copy-request">Copy request URL</button></div>` : ""}`}
    <div class="request-preview"><div class="result-heading"><span>REQUEST URL</span><span id="request-method">${escapeHTML(endpoint.method)}</span></div><code id="request-url">${escapeHTML(API_BASE + endpoint.path)}</code></div>
    <section id="response-section" class="response-section" hidden><div class="result-heading"><span>RESPONSE</span><span id="response-status"></span><span id="response-duration"></span><button class="copy-button" id="copy-response">Copy JSON</button></div><div class="safe-headers" id="response-headers"></div><pre class="response-json" id="response-json"></pre></section>
    <h2>Response schema</h2>
    <p class="muted">${schemaForOperation(endpoint) === "Response schema not specified." ? "The OpenAPI specification does not define a response schema for this operation. Returned JSON is shown without assumptions." : "Schema generated from the live OpenAPI specification."}</p>
    <div class="code-block"><div class="code-block-head"><span>OPENAPI RESPONSE</span></div><pre><code>${escapeHTML(schemaForOperation(endpoint))}</code></pre></div>
    <h2>Request examples</h2><div class="example-tabs"><button class="example-tab active" data-example-language="curl">curl</button><button class="example-tab" data-example-language="javascript">JavaScript</button><button class="example-tab" data-example-language="typescript">TypeScript</button><button class="example-tab" data-example-language="python">Python</button></div><div class="code-block"><div class="code-block-head"><span id="example-language-label">CURL</span><button class="copy-button" id="copy-endpoint-example" data-copy="${escapeHTML(examples.curl)}">Copy</button></div><pre><code id="endpoint-example-code">${escapeHTML(examples.curl)}</code></pre></div>
    ${endpoint.path.includes("/stream") ? `<p class="muted">For this streaming endpoint, use the <a href="#sse" data-page="sse">SSE console</a> or curl with <code class="inline-code">-N</code> to keep the response unbuffered.</p>` : ""}`;
  $("#detail-page").classList.add("active");
  showPage("detail", "API Reference");
  bindRequestForm(endpoint, params);
}

function requestUrlFor(endpoint, params, form) {
  const url = new URL(API_BASE + endpoint.path.replace(/\{([^}]+)\}/g, (_, name) => {
    const field = form?.elements.namedItem(name);
    return encodeURIComponent(field?.value || `{${name}}`);
  }));
  for (const parameter of params.filter((item) => item.in === "query")) {
    const field = form?.elements.namedItem(parameter.name);
    if (!field || field.value === "") continue;
    const value = field.type === "datetime-local" ? new Date(field.value).toISOString() : field.value;
    url.searchParams.set(parameter.name, value);
  }
  return url.toString();
}

function exampleQuery(params, endpoint) {
  const values = {};
  for (const parameter of params) {
    if (parameter.in !== "query") continue;
    const schema = parameter.schema || {};
    if (schema.default !== undefined) values[parameter.name] = String(schema.default);
    else if (parameter.required && parameter.name === "q") values.q = "example search";
    else if (parameter.required && parameter.name === "box") values.box = "1234";
    else if (parameter.name === "since_id" && endpoint.path.endsWith("/stream")) values.since_id = "0";
  }
  return values;
}

function pathForExample(path) {
  return path.replace(/\{([^}]+)\}/g, "REPLACE_WITH_$1");
}

function endpointExamples(endpoint, params) {
  if (endpoint.audienceScoped) return audienceExamples(endpoint);
  const examplePath = pathForExample(endpoint.path);
  const values = exampleQuery(params, endpoint);
  const query = new URLSearchParams(values).toString();
  const url = `${PUBLIC_API_BASE}${examplePath}${query ? `?${query}` : ""}`;
  const jsPath = endpoint.path.replace(/\{([^}]+)\}/g, "${encodeURIComponent('REPLACE_WITH_$1')}");
  const jsUrl = `\`${PUBLIC_API_BASE}${jsPath}\``;
  const exampleObject = JSON.stringify(values, null, 2);
  if (endpoint.path.endsWith("/stream")) {
    const streamUrl = `${PUBLIC_API_BASE}${endpoint.path}${query ? `?${query}` : ""}`;
    const eventSource = `const source = new EventSource(${JSON.stringify(streamUrl)});\nsource.onmessage = ({ data, lastEventId }) => console.log(lastEventId, data);\nsource.onerror = () => console.warn("Stream disconnected; EventSource will retry.");`;
    const node = `const response = await fetch(${JSON.stringify(streamUrl)}, {\n  headers: { Accept: "text/event-stream" }\n});\nif (!response.ok || !response.body) throw new Error(\`HTTP \${response.status}\`);\nfor await (const chunk of response.body) {\n  process.stdout.write(new TextDecoder().decode(chunk));\n}`;
    const pythonSse = `import requests\n\nurl = ${JSON.stringify(streamUrl)}\nwith requests.get(url, headers={"Accept": "text/event-stream"}, stream=True, timeout=(10, None)) as response:\n    response.raise_for_status()\n    response.encoding = response.encoding or "utf-8"\n    for line in response.iter_lines(decode_unicode=True):\n        if line:\n            print(line)`;
    return {
      curl: `curl -N '${streamUrl}'`,
      javascript: eventSource,
      typescript: node,
      python: pythonSse
    };
  }
  const querySetup = Object.keys(values).length
    ? `const params = new URLSearchParams(${JSON.stringify(values)});\nconst url = new URL(${jsUrl});\nurl.search = params.toString();`
    : `const url = new URL(${jsUrl});`;
  const fetchCode = `${querySetup}\nconst response = await fetch(url);\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconst data = await response.json();\nconsole.log(data);`;
  const pythonParams = Object.keys(values).length ? `, params=${exampleObject.replace(/: /g, ": ")}` : "";
  const python = `import requests\n\nresponse = requests.get(${JSON.stringify(`${PUBLIC_API_BASE}${examplePath}`)}${pythonParams}, timeout=30)\nresponse.raise_for_status()\ndata = response.json()\nprint(data)`;
  const curl = endpoint.method === "GET" ? `curl -sS '${url}'` : `# ${endpoint.method} ${url}\n# This operation is not sent from the public portal.`;
  return { curl, javascript: fetchCode, typescript: fetchCode, python };
}

function bindRequestForm(endpoint, params) {
  const form = $("#request-form");
  const updateExamples = () => {
    const tab = $(".example-tab.active");
    const code = endpointExamples(endpoint, params)[tab?.dataset.exampleLanguage || "curl"];
    $("#endpoint-example-code").textContent = code;
    $("#copy-endpoint-example").dataset.copy = code;
  };
  const updatePreview = () => {
    const url = requestUrlFor(endpoint, params, form);
    $("#request-url").textContent = url;
    if (endpoint.audienceScoped) updateExamples();
  };
  form?.addEventListener("input", updatePreview);
  $("#param-audience")?.addEventListener("change", (event) => {
    selectAudience(event.target.value);
    updateExamples();
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    executeRequest(endpoint, params, form);
  });
  $("#send-no-param")?.addEventListener("click", () => executeRequest(endpoint, params, form));
  $("#copy-request")?.addEventListener("click", () => copyText(requestUrlFor(endpoint, params, form)));
  $("#copy-response")?.addEventListener("click", () => copyText($("#response-json").textContent));
  $$(".example-tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".example-tab").forEach((item) => item.classList.toggle("active", item === tab));
    const code = endpointExamples(endpoint, params)[tab.dataset.exampleLanguage];
    $("#endpoint-example-code").textContent = code;
    $("#example-language-label").textContent = tab.textContent.toUpperCase();
    $("#copy-endpoint-example").dataset.copy = code;
  }));
  updatePreview();
  if (endpoint.path === "/v1/incidents") loadIncidentFilterOptions(form);
}

async function loadReferenceOptions(path) {
  if (!referenceData.has(path)) {
    referenceData.set(path, fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
        const body = await response.json();
        const rows = Array.isArray(body) ? body : Array.isArray(body?.value) ? body.value : [];
        if (!rows.length || !rows.every((row) => row && typeof row === "object" && "id" in row && "name" in row)) {
          throw new Error(`${path} did not return reference rows with id and name fields.`);
        }
        return rows;
      }).catch((error) => {
        referenceData.delete(path);
        throw error;
      }));
  }
  return referenceData.get(path);
}

async function loadIncidentFilterOptions(form) {
  const referencePathByFilter = {
    borough: "/v1/boroughs",
    category: "/v1/categories",
    status: "/v1/statuses",
    agency: "/v1/agencies"
  };
  await Promise.all(Object.entries(referencePathByFilter).map(async ([filter, path]) => {
    const select = form.elements.namedItem(filter);
    if (!select || select.tagName !== "SELECT") return;
    try {
      const options = await loadReferenceOptions(path);
      if (!form.isConnected) return;
      for (const item of options) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        select.append(option);
      }
    } catch (error) {
      console.warn(`Unable to load ${filter} reference values.`, error);
      if (!form.isConnected) return;
      const input = document.createElement("input");
      input.className = "param-input";
      input.id = select.id;
      input.name = select.name;
      input.placeholder = "Enter filter value";
      select.replaceWith(input);
      $(`#filter-help-${filter}`).textContent = `Reference values unavailable; enter an API filter value manually (${error.message}).`;
    }
  }));
}

async function executeRequest(endpoint, params, form) {
  if (endpoint.audienceScoped || endpoint.restricted || endpoint.method !== "GET") {
    showToast(endpoint.audienceScoped ? AUDIENCE_ACCESS_MESSAGE : "This operation is documentation only.");
    return;
  }
  const url = requestUrlFor(endpoint, params, form);
  $("#request-url").textContent = url;
  const button = $(".request-actions .button-primary");
  if (button) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "Requesting…";
  }
  const start = performance.now();
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.text();
    let formattedBody = body;
    try { formattedBody = JSON.stringify(JSON.parse(body), null, 2); } catch { /* Preserve non-JSON response text. */ }
    $("#response-section").hidden = false;
    $("#response-status").textContent = `${response.status} ${response.statusText}`;
    $("#response-status").className = `response-code ${response.ok ? "success" : "failure"}`;
    $("#response-duration").textContent = `${Math.round(performance.now() - start)} ms`;
    $("#response-json").textContent = formattedBody || "(empty response)";
    const safeHeaders = ["content-type", "cache-control", "retry-after"]
      .map((name) => [name, response.headers.get(name)])
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}: ${value}`)
      .join(" · ");
    $("#response-headers").textContent = safeHeaders || "No safe response headers exposed";
    $("#response-section").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    $("#response-section").hidden = false;
    $("#response-status").textContent = "Network / CORS error";
    $("#response-status").className = "response-code failure";
    $("#response-duration").textContent = `${Math.round(performance.now() - start)} ms`;
    $("#response-headers").textContent = "Response headers unavailable (browser network/CORS error)";
    $("#response-json").textContent = `${error.message}\n\nThe browser could not read this response. The API may not allow cross-origin requests from this site. Try the request with curl or from an authorized backend.`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalText || "Send request →";
    }
  }
}

function updateActiveNav() {
  $$(".nav-link").forEach((link) => link.classList.remove("active"));
  const selector = currentPage === "detail" ? `[data-endpoint-index="${selectedEndpoint}"]` : `[data-page="${currentPage}"]`;
  $(selector)?.classList.add("active");
  const titles = { overview: "Overview", quickstart: "Quick start", authentication: "Authentication & SSO", audiences: "Audiences & access", sse: "SSE console", errors: "Errors & validation", openapi: "OpenAPI specification", detail: "API Reference" };
  $("#current-section").textContent = currentPage === "detail" && selectedEndpoint !== null ? endpoints[selectedEndpoint]?.label || titles.detail : titles[currentPage] || "Documentation";
}

function showPage(page, title) {
  if (page === "incidents") page = "audiences";
  if (page !== "sse" && streamRunning) stopStream();
  currentPage = page;
  $$(".page").forEach((section) => section.classList.remove("active"));
  const pageEl = $(`#${page}-page`);
  pageEl?.classList.add("active");
  $("#current-section").textContent = title || page;
  updateActiveNav();
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const endpointLink = event.target.closest("[data-endpoint-index]");
    if (endpointLink) {
      event.preventDefault();
      showEndpoint(Number(endpointLink.dataset.endpointIndex));
      return;
    }
    const pageLink = event.target.closest("[data-page], [data-open-page]");
    if (pageLink) {
      event.preventDefault();
      const page = pageLink.dataset.page || pageLink.dataset.openPage;
      showPage(page);
      return;
    }
    if (event.target.closest("[data-home]")) {
      event.preventDefault();
      showPage("overview");
    }
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) copyText(copyButton.dataset.copy);
  });
  $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#nav-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    $$(".endpoint-nav-link").forEach((link) => {
      const endpoint = endpoints[Number(link.dataset.endpointIndex)];
      const searchable = [
        link.textContent,
        endpoint?.path,
        endpoint?.description,
        ...operationParameters(endpoint || {}).map((parameter) => parameter.name)
      ].join(" ").toLowerCase();
      link.hidden = query.length > 0 && !searchable.includes(query);
    });
    $$(".endpoint-group-label").forEach((label) => {
      label.hidden = !label.nextElementSibling || ![...label.parentElement.querySelectorAll(".endpoint-nav-link")].some((link) => !link.hidden);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      $("#nav-search").focus();
    }
    if (event.key === "Escape") $("#sidebar").classList.remove("open");
  });
}

function setConnection(state, text, meta = "") {
  const light = $("#connection-light");
  light.className = `connection-light ${state}`;
  $("#connection-label").textContent = text;
  $("#stream-meta").textContent = meta;
}

function renderEvent(event) {
  if (event.id) $("#stream-last-id").textContent = `Last event ID: ${event.id}`;
  if (event.comment || event.event === "heartbeat") {
    $("#stream-heartbeat").textContent = `Last heartbeat: ${new Date().toLocaleTimeString()}`;
  }
  if (streamPaused) {
    bufferedEvents.push(event);
    if (bufferedEvents.length > 200) {
      bufferedEvents.shift();
      droppedPausedEvents++;
    }
    $("#event-count").textContent = `${displayedEvents} events · paused`;
    return;
  }
  const feed = $("#event-feed");
  if (displayedEvents === 0) feed.innerHTML = "";
  const card = document.createElement("article");
  card.className = "event-card";
  const content = event.data || (event.comment ? `[heartbeat] ${event.comment}` : "[empty event]");
  let formatted = content;
  try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { /* Keep SSE text payloads intact. */ }
  card.innerHTML = `<div class="event-head"><span class="event-type">${escapeHTML(event.event || (event.comment ? "heartbeat" : "message"))}</span>${event.id ? `<span class="event-id">id: ${escapeHTML(event.id)}</span>` : ""}<span class="event-time">${new Date().toLocaleTimeString()}</span></div><pre>${escapeHTML(formatted)}</pre><div class="event-actions"><button class="copy-button" data-copy="${escapeHTML(content)}">Copy payload</button></div>`;
  feed.prepend(card);
  displayedEvents++;
  while (feed.querySelectorAll(".event-card").length > 200) feed.lastElementChild.remove();
  $("#event-count").textContent = `${displayedEvents} event${displayedEvents === 1 ? "" : "s"}`;
}

async function consumeSse(response, signal) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stream returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  if (!response.body) throw new Error("This browser does not support streaming response bodies.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = { data: "", event: "", id: "", comment: "" };
  const dispatch = () => {
    if (event.id && /^\d+$/.test(event.id)) latestEventId = event.id;
    if (event.data || event.event || event.comment) {
      if (!event.id || !seenEventIds.has(event.id)) {
        if (event.id) {
          seenEventIds.add(event.id);
          if (seenEventIds.size > 1000) seenEventIds.delete(seenEventIds.values().next().value);
        }
        renderEvent({ ...event });
      }
    }
    event = { data: "", event: "", id: "", comment: "" };
  };
  const processLine = (line) => {
    if (line === "") {
      dispatch();
    } else if (line.startsWith(":")) {
      renderEvent({ event: "heartbeat", comment: line.slice(1).trim() });
    } else {
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let valueText = colon === -1 ? "" : line.slice(colon + 1);
      if (valueText.startsWith(" ")) valueText = valueText.slice(1);
      if (field === "data") event.data = event.data ? `${event.data}\n${valueText}` : valueText;
      if (field === "event") event.event = valueText;
      if (field === "id" && !valueText.includes("\0")) event.id = valueText;
    }
  };
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = buffer.search(/[\r\n]/)) !== -1) {
      const delimiter = buffer[boundary];
      if (!done && delimiter === "\r" && boundary === buffer.length - 1) break;
      processLine(buffer.slice(0, boundary));
      const delimiterLength = delimiter === "\r" && buffer[boundary + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(boundary + delimiterLength);
    }
    if (done) {
      if (buffer) processLine(buffer);
      dispatch();
      break;
    }
    if (buffer && buffer.length > 1_048_576) {
      throw new Error("The stream sent an oversized event without a line break.");
    }
  }
  if (!signal.aborted) throw new Error("The stream connection closed.");
}

function streamUrl() {
  const source = $("#sse-audience").value;
  const streamPath = source === "legacy" ? "/v1/incidents/stream" : `/v1/audiences/${encodeURIComponent(source)}/stream`;
  const url = new URL(`${API_BASE.replace(/\/$/, "")}${streamPath}`);
  const since = $("#sse-since").value;
  const type = $("#sse-type").value.trim();
  if (since !== "") url.searchParams.set("since_id", since);
  if (source === "legacy" && type !== "" && type.toLowerCase() !== "all") url.searchParams.set("type", type);
  return url.toString();
}

async function runStream(generation = streamGeneration) {
  if (!streamRunning || generation !== streamGeneration) return;
  const controller = new AbortController();
  streamController = controller;
  setConnection("connecting", "Connecting", `Attempting ${streamUrl()}`);
  try {
    const url = new URL(streamUrl());
    if (latestEventId) url.searchParams.set("since_id", latestEventId);
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal: controller.signal
    });
    if (generation !== streamGeneration || !streamRunning) return;
    if (!response.ok) {
      const body = await response.text();
      const status = response.status;
      if (status >= 400 && status < 500 && status !== 429) {
        stopStream();
        setConnection("error", status === 401 || status === 403 ? "Access denied" : `HTTP ${status}`, `HTTP ${status}: ${body.slice(0, 300)}`);
        return;
      }
      throw new Error(`Stream returned HTTP ${status}: ${body.slice(0, 300)}`);
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      controller.abort();
      throw new Error("The server did not return text/event-stream.");
    }
    setConnection("connected", "Connected", `Connected for ${Math.round((Date.now() - streamStartedAt) / 1000)}s`);
    await consumeSse(response, controller.signal);
  } catch (error) {
    if (!streamRunning || generation !== streamGeneration || error.name === "AbortError") return;
    console.error("SSE stream connection failed.", error);
    setConnection("error", "Connection lost", `${error.message} · retrying in 3s`);
    reconnectTimer = setTimeout(() => runStream(generation), 3000);
  }
}

function startStream() {
  if ($("#sse-audience").value !== "legacy") {
    setConnection("error", "Audience access locked", AUDIENCE_ACCESS_MESSAGE);
    return;
  }
  const sinceInput = $("#sse-since");
  if (sinceInput.value !== "" && (!/^\d+$/.test(sinceInput.value) || Number(sinceInput.value) < 0)) {
    sinceInput.setCustomValidity("Enter an integer greater than or equal to 0.");
    sinceInput.reportValidity();
    return;
  }
  sinceInput.setCustomValidity("");
  if ($("#sse-type").value.length > 100) {
    $("#sse-type").setCustomValidity("Event type must be 100 characters or fewer.");
    $("#sse-type").reportValidity();
    return;
  }
  $("#sse-type").setCustomValidity("");
  latestEventId = sinceInput.value;
  seenEventIds.clear();
  streamGeneration++;
  streamRunning = true;
  streamStartedAt = Date.now();
  $("#sse-since").disabled = true;
  $("#sse-type").disabled = true;
  $("#sse-audience").disabled = true;
  $("#sse-toggle").innerHTML = '<span class="connect-mark">■</span> Disconnect';
  $("#sse-toggle").classList.add("button-disconnect");
  runStream();
}

function stopStream() {
  streamRunning = false;
  streamGeneration++;
  clearTimeout(reconnectTimer);
  streamController?.abort();
  streamController = null;
  $("#sse-since").disabled = false;
  $("#sse-type").disabled = false;
  $("#sse-audience").disabled = false;
  $("#sse-toggle").innerHTML = '<span class="connect-mark">▶</span> Connect to stream';
  setConnection("disconnected", "Disconnected", "Stream closed");
}

function bindSseControls() {
  $("#sse-audience").addEventListener("change", (event) => {
    if (event.target.value !== "legacy") selectAudience(event.target.value);
    updateSseAudience();
  });
  $("#sse-toggle").addEventListener("click", () => streamRunning ? stopStream() : startStream());
  $("#clear-events").addEventListener("click", () => {
    if ($("#sse-audience").value !== "legacy") {
      updateSseAudience();
      return;
    }
    displayedEvents = 0;
    bufferedEvents = [];
    droppedPausedEvents = 0;
    $("#event-count").textContent = "0 events";
    $("#event-feed").innerHTML = '<div class="empty-stream"><span>⌁</span><strong>No events yet</strong><p>Connect to the stream to receive published incident events.</p></div>';
  });
  $("#pause-events").addEventListener("change", (event) => {
    streamPaused = event.target.checked;
    if (!streamPaused) {
      const pending = bufferedEvents;
      bufferedEvents = [];
      pending.forEach(renderEvent);
      $("#event-count").textContent = `${displayedEvents} events`;
      if (droppedPausedEvents) showToast(`${droppedPausedEvents} older paused events were dropped`);
      droppedPausedEvents = 0;
    }
  });
}

function addDynamicStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .endpoint-group-label{margin:10px 8px 3px;color:#52667e;font-size:8px;letter-spacing:.9px;font-weight:700}
    .endpoint-group-label:first-child{margin-top:0}
    .operation-title{display:flex;align-items:center;gap:11px;margin:17px 0 21px;padding:11px 12px;border:1px solid var(--border);border-radius:5px;background:#0a1725}
    .operation-title>code{font:11px var(--mono);overflow-wrap:anywhere;color:#dbe6f1}
    .operation-title>span:last-child{margin-left:auto;color:#7d91a8;font-size:10px;white-space:nowrap}
    .request-form{border:1px solid var(--border);border-radius:6px;background:#0a1725;padding:13px}
    .parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}
    .param-field label{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .param-field label code{font:10px var(--mono);color:#d7e4ef}
    .param-required{color:#73869b;font:9px var(--mono);font-weight:400}
    .param-required.is-required{color:var(--orange)}
    .param-field small{display:block;margin-top:5px;color:#7e90a5;font-size:9px;line-height:1.5}
    .param-field small span{color:#abc7d1;font-family:var(--mono)}
    .sse-field-help{display:block;margin-top:5px;color:#8496aa;font-size:9px;font-weight:400;line-height:1.5}
    .request-actions{display:flex;gap:8px;margin-top:14px}
    .field-hint{font-size:10px;margin:12px 0 0}
    .request-preview{margin-top:15px;border:1px solid var(--border);border-radius:5px;background:#081421;overflow:hidden}
    .result-heading{display:flex;align-items:center;gap:12px;min-height:34px;padding:0 10px;border-bottom:1px solid var(--border-soft);color:#71859b;font:9px var(--mono);letter-spacing:.6px}
    .result-heading>code{margin-left:auto;color:#bdd0df;overflow-wrap:anywhere;font:9px var(--mono);letter-spacing:0;padding:8px 10px}
    .result-heading>span:nth-child(2){margin-left:auto}
    .result-heading>span.response-code{font:10px var(--mono);letter-spacing:0}
    .response-code.success{color:var(--green)}.response-code.failure{color:var(--red)}
    .response-json{overflow:auto;max-height:480px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:13px;color:#c5d4e3;font:10px/1.7 var(--mono)}
    .safe-headers{padding:8px 10px;border-bottom:1px solid var(--border-soft);color:#8ea2b8;font:9px var(--mono);overflow-wrap:anywhere}
    .response-section{margin-top:15px;border:1px solid var(--border);border-radius:5px;background:#081421;overflow:hidden}
    .response-section .copy-button{margin-left:auto}
    .example-tabs{display:flex;gap:5px;margin:0 0 -12px;padding:0 8px;position:relative;z-index:1}
    .example-tab{border:1px solid transparent;border-radius:4px 4px 0 0;background:transparent;color:#8396aa;padding:5px 8px;font:10px var(--sans);cursor:pointer}
    .example-tab.active{background:#081421;border-color:var(--border);border-bottom-color:#081421;color:var(--cyan)}
    [hidden]{display:none!important}
    @media(max-width:760px){.parameter-grid{grid-template-columns:1fr}.operation-title{flex-wrap:wrap}.operation-title>span:last-child{margin-left:0}.result-heading>code{max-width:75%;font-size:8px}}
  `;
  document.head.append(style);
}

function init() {
  addDynamicStyles();
  bindAudienceControls();
  bindNavigation();
  bindSseControls();
  renderNavigation();
  renderEndpointIndexes();
  loadOpenApi();
  if (window.location.hash === "#sse") showPage("sse");
}

init();
