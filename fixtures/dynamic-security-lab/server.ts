import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  handleDynamicSecurityLabRequest,
  resetLabState,
  type LabHttpRequest,
} from "@/lib/dynamic-security-lab/handler";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeLabResponse(res: ServerResponse, labResponse: Awaited<ReturnType<typeof handleDynamicSecurityLabRequest>>) {
  if (labResponse.body === null || labResponse.body === undefined) {
    res.writeHead(labResponse.status, labResponse.headers);
    res.end();
    return;
  }
  res.writeHead(labResponse.status, labResponse.headers);
  res.end(JSON.stringify(labResponse.body));
}

function toLabRequest(req: IncomingMessage, body: string, pathname: string, searchParams: URLSearchParams): LabHttpRequest {
  const headers: LabHttpRequest["headers"] = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = value;
  }
  return {
    method: (req.method ?? "GET").toUpperCase(),
    pathname,
    searchParams,
    headers,
    body: body || undefined,
  };
}

export type DynamicSecurityLab = {
  server: Server;
  origin: string;
  port: number;
  resetState(): void;
  close(): Promise<void>;
};

export async function startDynamicSecurityLab(port = 0): Promise<DynamicSecurityLab> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    const body =
      method === "GET" || method === "HEAD" || method === "OPTIONS" ? "" : await readBody(req);
    const labRequest = toLabRequest(req, body, url.pathname, url.searchParams);
    const labResponse = await handleDynamicSecurityLabRequest(labRequest);
    writeLabResponse(res, labResponse);
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve dynamic security lab port");
  }

  return {
    server,
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    resetState: () => resetLabState(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export { resetLabState } from "@/lib/dynamic-security-lab/handler";
