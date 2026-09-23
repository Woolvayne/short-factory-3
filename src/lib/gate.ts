/**
 * Onepage password gate — 100 % frontend, no backend, no database.
 *
 * The password itself never lives in the repo. It is injected at BUILD time
 * through a Vercel environment variable:
 *
 *   VITE_APP_PASSWORD_HASH   ← SHA-256 of the password (recommended)
 *   VITE_APP_PASSWORD        ← plaintext fallback (simple, less secure)
 *
 * `npm run password:hash -- "meinPasswort"` prints the hash and the exact
 * `vercel env add` command. Full guide: docs/ANLEITUNG.md
 *
 * If neither variable is set, the gate is disabled and the factory opens
 * directly (that is what makes local `npm run dev` frictionless).
 *
 * The same variable also guards the Zernio shipping route: after unlocking,
 * the browser stores a token (the SHA-256 digest, or the plaintext password
 * when plaintext mode is used) and sends it as `x-sf-auth` on every
 * `/api/zernio` call, where `api/zernio.js` re-checks it server-side.
 */

const SESSION_KEY = "shortsfactory.gate.session.v1";
const PERSIST_KEY = "shortsfactory.gate.persist.v1";

/** Vite replaces these at build time — nothing secret is shipped as source. */
const ENV_HASH = String(import.meta.env.VITE_APP_PASSWORD_HASH ?? "")
  .trim()
  .toLowerCase();
const ENV_PLAIN = String(import.meta.env.VITE_APP_PASSWORD ?? "").trim();

export type GateMode = "hash" | "plain" | "off";

export const gateMode = (): GateMode => (ENV_HASH ? "hash" : ENV_PLAIN ? "plain" : "off");

export const gateEnabled = (): boolean => gateMode() !== "off";

/** SHA-256 hex digest — needs a secure context (HTTPS or localhost). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "crypto.subtle fehlt — die Passwort-Prüfung läuft nur über HTTPS oder localhost."
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent comparison so timing leaks stay useless. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Checks a typed password and returns the token that unlocks the app
 * (and authenticates `/api/zernio`). Returns `null` when it is wrong.
 */
export async function verifyPassword(input: string): Promise<string | null> {
  const mode = gateMode();
  if (mode === "off") return "";
  const candidates = [input, input.trim()];

  if (mode === "hash") {
    for (const candidate of candidates) {
      const digest = await sha256Hex(candidate);
      if (safeEqual(digest, ENV_HASH)) return digest;
    }
    return null;
  }

  for (const candidate of candidates) {
    if (safeEqual(candidate, ENV_PLAIN)) return candidate;
  }
  return null;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, remember: boolean): void {
  try {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
    if (value) (remember ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    /* private mode — the gate still works for this page load */
  }
}

/** A stored token is only valid while it still matches the deployed env var. */
function tokenStillValid(token: string): boolean {
  const mode = gateMode();
  if (mode === "hash") return safeEqual(token, ENV_HASH);
  if (mode === "plain") return safeEqual(token, ENV_PLAIN);
  return true;
}

export function isUnlocked(): boolean {
  if (!gateEnabled()) return true;
  const token = read(SESSION_KEY) ?? read(PERSIST_KEY);
  return Boolean(token) && tokenStillValid(String(token));
}

export function unlock(token: string, remember: boolean): void {
  write(SESSION_KEY, remember ? null : token, false);
  write(PERSIST_KEY, remember ? token : null, true);
}

export function lock(): void {
  write(SESSION_KEY, null, false);
  write(PERSIST_KEY, null, true);
}

/** Header value for `/api/zernio` — empty when no gate is configured. */
export function gateToken(): string {
  if (!gateEnabled()) return "";
  const token = read(SESSION_KEY) ?? read(PERSIST_KEY);
  return token && tokenStillValid(String(token)) ? String(token) : "";
}

/** Convenience for every fetch that must pass the gate. */
export function gateHeaders(): Record<string, string> {
  const token = gateToken();
  return token ? { "x-sf-auth": token } : {};
}

export const gateInfo = () => ({
  mode: gateMode(),
  enabled: gateEnabled(),
  hint: ENV_HASH
    ? "VITE_APP_PASSWORD_HASH ist gesetzt (SHA-256)."
    : ENV_PLAIN
      ? "VITE_APP_PASSWORD ist gesetzt (Klartext — besser: Hash verwenden)."
      : "Kein Passwort gesetzt → die App ist offen. Anleitung: docs/ANLEITUNG.md",
});
