// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 2026-10-14: the sign-up screen said "we sent a confirmation link" whenever signUp returned no error, which includes Supabase's answer to an
// email that already has an account (no error, no new user, no message). The screen must stay neutral: same output for every non-error
// answer (so it cannot be used to learn which emails exist), no claim of delivery, and a way forward (sign in, recover access, check email).
let lang: "en" | "es" = "en";
const lookup = (ns: string, key: string, params?: Record<string, unknown>) => {
  let node: unknown = JSON.parse(readFileSync(`messages/${lang}/${ns}.json`, "utf8"));
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${ns}.${key}`);
  return node.replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
};
vi.mock("@/lib/i18n/client", () => ({ useI18n: (ns: string) => ({ t: (k: string, p?: Record<string, unknown>) => lookup(ns, k, p), locale: lang }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/features/auth/components/OAuthProviderButtons", () => ({ OAuthProviderButtons: () => null }));
const signUp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signUp } }) }));

import { SignupForm } from "../SignupForm";

let root: Root; let container: HTMLElement;
beforeEach(() => { signUp.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function submit(answer: unknown, email = "person@example.com") {
  signUp.mockResolvedValue(answer);
  act(() => root.render(createElement(SignupForm)));
  const set = (selector: string, value: string) => {
    const el = container.querySelector(selector) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const inputs = [...container.querySelectorAll("input")];
  const byType = (type: string) => inputs.find((i) => i.type === type);
  await act(async () => {
    set(`input[type="email"]`, email);
    set(`input[type="password"]`, "a-long-enough-password");
    const name = inputs.find((i) => i.type === "text");
    if (name) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Test Person"), name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  void byType;
  await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
}

const NEW_USER = { data: { user: { id: "u1", identities: [{ provider: "email" }] }, session: null }, error: null };
const EXISTING_EMAIL = { data: { user: { id: "u2", identities: [] }, session: null }, error: null }; // Supabase's obfuscated answer
const NOTHING_USEFUL = { data: { user: null, session: null }, error: null };

describe.each(["en", "es"] as const)("sign-up result screen [%s]", (l) => {
  beforeEach(() => { lang = l; });

  it("is byte-for-byte the same for a new email, an already-registered email and an empty answer (no enumeration)", async () => {
    await submit(NEW_USER); const a = container.innerHTML; act(() => root.unmount()); container.remove();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await submit(EXISTING_EMAIL); const b = container.innerHTML; act(() => root.unmount()); container.remove();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await submit(NOTHING_USEFUL); const c = container.innerHTML;
    expect(container.querySelector('[data-testid="signup-received"]')).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("claims no delivery, and offers sign in, recovery and checking the email", async () => {
    await submit(NEW_USER);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(l === "en" ? /we sent|has been sent|was sent|sent you|link to/i : /hemos enviado|se ha enviado|te enviamos|enlace de confirmaci/i);
    expect(text).toMatch(l === "en" ? /can't confirm delivery/i : /no podemos confirmar la entrega/i);
    expect(text).toMatch(l === "en" ? /check your email, including spam/i : /revisa tu correo, incluida la carpeta de spam/i);
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href")).sort()).toEqual(["/forgot-password", "/login"]);
  });

  it("a real error from signUp is still shown as an error, not as the neutral screen", async () => {
    await submit({ data: { user: null, session: null }, error: { message: "Email rate limit exceeded" } });
    expect(container.querySelector('[data-testid="signup-received"]')).toBeNull();
    expect(container.textContent).toContain("Email rate limit exceeded");
  });
});

it("the component never branches on what signUp returned beyond the error (static guard)", () => {
  const source = readFileSync("app/(auth)/signup/SignupForm.tsx", "utf8");
  expect(source).not.toMatch(/identities|data\.user|data\.session/);
});
