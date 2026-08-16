import "server-only";

export async function parseOAuthFormBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json).map(([key, value]) => [key, String(value ?? "")])
    );
  }

  const text = await request.text();
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

export function requireParam(body: Record<string, string>, name: string): string {
  const value = body[name]?.trim();
  if (!value) {
    throw new Error(`missing:${name}`);
  }
  return value;
}
