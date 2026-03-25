const DIRECT_UPSTREAM_URL = "https://api.lolimi.cn/API/baby/gohome?type=json";
const FALLBACK_UPSTREAM_URL =
  "https://r.jina.ai/http://api.lolimi.cn/API/baby/gohome?type=json";
const MAX_DIRECT_RETRIES = 2;
const UPSTREAM_TIMEOUT_MS = 9000;
const EDGE_CACHE_TTL_SECONDS = 20;
const LAST_GOOD_TTL_MS = 10 * 60 * 1000;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
let lastGoodPayload = null;
let lastGoodAt = 0;

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");

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

function createCacheKey(request) {
  const url = new URL(request.url);
  url.pathname = "/__baby_cache";
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

function buildSuccessResponse(payload, cacheHeaderValue, extraHeaders = {}) {
  return jsonResponse(payload, {
    status: 200,
    headers: {
      "Cache-Control": cacheHeaderValue,
      ...extraHeaders,
    },
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
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
      cf: {
        cacheTtlByStatus: {
          "200-299": 30,
          "400-599": 0,
        },
      },
    });

    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function proxyUpstream(request) {
  const cache = caches.default;
  const cacheKey = createCacheKey(request);
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    const headers = new Headers(cachedResponse.headers);
    headers.set("x-worker-cache", "HIT");
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers,
    });
  }

  let lastStatus = null;
  let lastError = null;

  for (let i = 0; i < MAX_DIRECT_RETRIES; i += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(DIRECT_UPSTREAM_URL);
      lastStatus = response.status;

      const payload = parseJsonFromText(text);
      if (isValidUpstreamPayload(payload)) {
        const successResponse = buildSuccessResponse(
          payload,
          `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${EDGE_CACHE_TTL_SECONDS}`,
          { "x-worker-cache": "MISS" },
        );
        lastGoodPayload = payload;
        lastGoodAt = Date.now();
        await cache.put(cacheKey, successResponse.clone());
        return successResponse;
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
      const successResponse = buildSuccessResponse(
        payload,
        `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${EDGE_CACHE_TTL_SECONDS}`,
        { "x-worker-cache": "MISS-FALLBACK" },
      );
      lastGoodPayload = payload;
      lastGoodAt = Date.now();
      await cache.put(cacheKey, successResponse.clone());
      return successResponse;
    }
    if (isRateLimitedPayload(payload)) {
      lastError = new Error("Fallback source rate limited");
    }
  } catch (error) {
    lastError = error;
  }

  if (lastGoodPayload && Date.now() - lastGoodAt <= LAST_GOOD_TTL_MS) {
    return buildSuccessResponse(lastGoodPayload, "public, max-age=10", {
      "x-worker-cache": "STALE-MEMORY",
    });
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
      return proxyUpstream(request);
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
