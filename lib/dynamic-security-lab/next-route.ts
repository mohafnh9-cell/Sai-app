import {
  handleDynamicSecurityLabRequest,
  type LabHttpRequest,
  type LabHttpResponse,
} from "./handler";

const ALLOWED_VERCEL_PROJECT_NAMES = new Set(["sequrai-security-lab"]);

export function isSecurityLabEnabled(): boolean {
  if (process.env.SEQURAI_SECURITY_LAB_ENABLED !== "true") return false;
  const projectName = process.env.VERCEL_PROJECT_NAME?.trim();
  if (projectName && !ALLOWED_VERCEL_PROJECT_NAMES.has(projectName)) {
    return false;
  }
  return true;
}

function headersFromRequest(request: Request): LabHttpRequest["headers"] {
  const headers: LabHttpRequest["headers"] = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

export async function labRequestFromFetch(request: Request): Promise<LabHttpRequest> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" || method === "OPTIONS"
      ? undefined
      : await request.text();

  return {
    method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers: headersFromRequest(request),
    body,
  };
}

export function labResponseToFetch(response: LabHttpResponse): Response {
  if (response.body === null || response.body === undefined) {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: response.headers,
  });
}

export async function handleSecurityLabRequest(request: Request): Promise<Response> {
  if (!isSecurityLabEnabled()) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const labRequest = await labRequestFromFetch(request);
  const labResponse = await handleDynamicSecurityLabRequest(labRequest);
  return labResponseToFetch(labResponse);
}

export const securityLabRouteHandlers = {
  GET: handleSecurityLabRequest,
  POST: handleSecurityLabRequest,
  OPTIONS: handleSecurityLabRequest,
  HEAD: handleSecurityLabRequest,
};
