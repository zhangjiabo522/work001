const UPSTREAM_URL = "https://api.lolimi.cn/API/baby/gohome?type=json";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

    if (url.pathname === "/") {
      return jsonResponse({
        code: 200,
        message: "Cloudflare Worker is running",
        endpoints: ["/api/baby"],
        upstream: UPSTREAM_URL,
      });
    }

    if (url.pathname !== "/api/baby") {
      return jsonResponse(
        {
          code: 404,
          message: "Not Found",
        },
        { status: 404 },
      );
    }

    try {
      const upstreamResponse = await fetch(UPSTREAM_URL, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "cloudflare-worker-baby-api/1.0",
        },
        cf: {
          cacheTtl: 30,
          cacheEverything: true,
        },
      });

      const text = await upstreamResponse.text();
      let payload;

      try {
        payload = JSON.parse(text);
      } catch {
        return jsonResponse(
          {
            code: 502,
            message: "Upstream did not return valid JSON",
            upstream_status: upstreamResponse.status,
            raw: text,
          },
          { status: 502 },
        );
      }

      return jsonResponse(payload, {
        status: upstreamResponse.ok ? 200 : upstreamResponse.status,
        headers: {
          "Cache-Control": "public, max-age=30",
        },
      });
    } catch (error) {
      return jsonResponse(
        {
          code: 500,
          message: "Failed to fetch upstream API",
          error: error instanceof Error ? error.message : String(error),
          upstream: UPSTREAM_URL,
        },
        { status: 500 },
      );
    }
  },
};
