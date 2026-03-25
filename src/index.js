const DIRECT_UPSTREAM_URL = "https://api.lolimi.cn/API/baby/gohome?type=json";
const FALLBACK_UPSTREAM_URL =
  "https://r.jina.ai/http://api.lolimi.cn/API/baby/gohome?type=json";
const MAX_DIRECT_RETRIES = 2;
const UPSTREAM_TIMEOUT_MS = 9000;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAuthorField(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const next = { ...payload };
  if ("author" in next) {
    delete next.author;
  }
  return next;
}

function isValidUpstreamPayload(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      payload.code === 200 &&
      payload.data &&
      (payload.data.id || payload.data.id === 0),
  );
}

function isRateLimitedPayload(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload.code === 429 ||
        payload.status === 429 ||
        payload.status === 42903 ||
        String(payload.message || "").toLowerCase().includes("rate limit")),
  );
}

function buildSuccessResponse(payload, extraHeaders = {}) {
  return jsonResponse(stripAuthorField(payload), {
    status: 200,
    headers: extraHeaders,
  });
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const maybeJson = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(maybeJson);
    } catch {}
  }

  return null;
}

async function fetchTextWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set("_ts", Date.now().toString());
    requestUrl.searchParams.set("_r", Math.random().toString(36).slice(2));

    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function proxyUpstream() {
  let lastStatus = null;
  let lastError = null;

  for (let i = 0; i < MAX_DIRECT_RETRIES; i += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(DIRECT_UPSTREAM_URL);
      lastStatus = response.status;

      const payload = parseJsonFromText(text);
      if (isValidUpstreamPayload(payload)) {
        return buildSuccessResponse(payload, { "x-worker-source": "direct" });
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250 * (i + 1));
  }

  try {
    const { response, text } = await fetchTextWithTimeout(FALLBACK_UPSTREAM_URL);
    lastStatus = response.status;
    const payload = parseJsonFromText(text);
    if (isValidUpstreamPayload(payload)) {
      return buildSuccessResponse(payload, { "x-worker-source": "fallback" });
    }
    if (isRateLimitedPayload(payload)) {
      lastError = new Error("Fallback source rate limited");
    }
  } catch (error) {
    lastError = error;
  }

  return jsonResponse(
    {
      code: 503,
      message: "Upstream temporarily unavailable",
      upstream_status: lastStatus,
      error: lastError instanceof Error ? lastError.message : null,
    },
    { status: 503 },
  );
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        {
          code: 405,
          message: "Method Not Allowed",
        },
        { status: 405 },
      );
    }

    if (url.pathname === "/" || url.pathname === "/api/baby") {
      return proxyUpstream();
    }

    return jsonResponse(
      {
        code: 404,
        message: "Not Found",
      },
      { status: 404 },
    );
  },
};
