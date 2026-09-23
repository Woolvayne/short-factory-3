/**
 * Zernio Versandweg — Client-Seite.
 *
 * Der API-Key bleibt im Serverless-Function (api/zernio.js, Vercel Env
 * `ZERNIO_API_KEY`). Hier passieren drei Dinge:
 *
 *   1. Video bei Zernio presignen + hochladen (POST /v1/media/presign → PUT)
 *   2. Post anlegen (POST /v1/posts) — sofort, geplant oder als Entwurf
 *   3. Reihenfolge-Takt: zwischen JEDEM Video warten `SHIP_GAP_MS` = 3 Sekunden
 *
 * Kein Kalender, keine Slot-Datenbank: Die Zeiten (06:00/20:00 täglich oder
 * frei gewählt) werden hier ausgerechnet und als `scheduledFor` +
 * `timezone: "Europe/Berlin"` an Zernio übergeben.
 *
 * API-Doku: https://docs.zernio.com · https://zernio.com/llms.txt
 */

import { gateHeaders } from "./gate";
import { sleep } from "./media";
import type { LocalRenderItem } from "./types";

const ENDPOINT = "/api/zernio";
const UPLOAD_ENDPOINT = "/api/zernio/upload";

/** Pflicht-Pause zwischen zwei Videos — exakt 3 Sekunden. */
export const SHIP_GAP_MS = 3000;

/** Vercel begrenzt Request-Bodies auf 4,5 MB → darüber nur Direktupload. */
const RELAY_MAX_BYTES = 4.2 * 1024 * 1024;

export const SHIP_TIMEZONE = "Europe/Berlin";

export interface ZernioAccount {
  id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profileId?: string;
  isActive?: boolean;
}

export interface ZernioStatus {
  ok: boolean;
  configured: boolean;
  accounts: ZernioAccount[];
  gate?: boolean;
  error?: string;
}

export type ShipMode = "now" | "slots" | "flex";

export interface ShipConfig {
  mode: ShipMode;
  /** Uhrzeiten (Europe/Berlin) für den Slot-Modus, z. B. ["06:00","20:00"] */
  slotTimes: string[];
  /** Startzeit (datetime-local Wert) für den Flex-Modus */
  flexStart: string;
  /** Abstand zwischen zwei Videos im Flex-Modus, in Minuten */
  flexIntervalMinutes: number;
  captionTemplate: string;
  hashtags: string;
  asDraft: boolean;
  /** Fester Post-Titel (YouTube ≤ 100 Zeichen) — leer = Titel aus dem Idea-Feld */
  titleOverride: string;
}

const SHIP_CFG_KEY = "shortsfactory.zernio.ship.v1";

export const DEFAULT_CAPTION_TEMPLATE = `{title}

{excerpt}

{hashtags}`;

export const DEFAULT_SHIP_CONFIG: ShipConfig = {
  mode: "now",
  slotTimes: ["06:00", "20:00"],
  flexStart: "",
  flexIntervalMinutes: 720,
  captionTemplate: DEFAULT_CAPTION_TEMPLATE,
  hashtags: "#shorts #redditstories #storytime #viral #fyp",
  asDraft: false,
  titleOverride: "",
};

export const FLEX_INTERVALS: { id: number; label: string }[] = [
  { id: 15, label: "15 MIN" },
  { id: 30, label: "30 MIN" },
  { id: 60, label: "1 STD" },
  { id: 120, label: "2 STD" },
  { id: 360, label: "6 STD" },
  { id: 720, label: "12 STD" },
  { id: 1440, label: "1 TAG" },
];

export function loadShipConfig(): ShipConfig {
  try {
    const raw = localStorage.getItem(SHIP_CFG_KEY);
    if (!raw) return { ...DEFAULT_SHIP_CONFIG };
    return { ...DEFAULT_SHIP_CONFIG, ...(JSON.parse(raw) as Partial<ShipConfig>) };
  } catch {
    return { ...DEFAULT_SHIP_CONFIG };
  }
}

export function saveShipConfig(cfg: ShipConfig): void {
  try {
    localStorage.setItem(SHIP_CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* private mode — nicht schlimm */
  }
}

/* ------------------------------------------------------------------ */
/*  Zeit-Fenster (Europe/Berlin) — ohne Kalender, nur Rechnerei         */
/* ------------------------------------------------------------------ */

interface BerlinParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function berlinParts(date: Date = new Date()): BerlinParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHIP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Berliner Uhrzeit → UTC-Millisekunden (DST-fest durch Nachkontrolle). */
export function berlinWallToMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const approx = Date.UTC(year, month - 1, day, hour, minute, 0);
  const seen = berlinParts(new Date(approx));
  let diff = hour * 60 + minute - (seen.hour * 60 + seen.minute);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return approx + diff * 60_000;
}

/** UTC-Millisekunden → "YYYY-MM-DDTHH:mm:00" in Berlin (so will es Zernio). */
export function msToBerlinWall(ms: number): string {
  const p = berlinParts(new Date(ms));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

export interface Slot {
  /** null = sofort veröffentlichen */
  ms: number | null;
  /** "2026-09-24T06:00:00" in Europe/Berlin, null = sofort */
  wall: string | null;
  /** menschenlesbar: "HEUTE 20:00" · "MORGEN 06:00" · "FR 26.09. 06:00" · "SOFORT" */
  label: string;
}

const WEEKDAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];

export function formatSlotLabel(ms: number | null): string {
  if (ms === null) return "SOFORT";
  const now = berlinParts();
  const then = berlinParts(new Date(ms));
  const dayDiff = Math.round(
    (Date.UTC(then.year, then.month - 1, then.day) - Date.UTC(now.year, now.month - 1, now.day)) /
      86_400_000
  );
  const time = `${pad(then.hour)}:${pad(then.minute)}`;
  if (dayDiff === 0) return `HEUTE ${time}`;
  if (dayDiff === 1) return `MORGEN ${time}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(then.year, then.month - 1, then.day)).getUTCDay()];
  return `${weekday} ${pad(then.day)}.${pad(then.month)}. ${time}`;
}

function parseTime(hhmm: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** "YYYY-MM-DDTHH:mm" aus einem <input type="datetime-local"> */
function parseDateTimeLocal(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  return berlinWallToMs(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

export function defaultFlexStart(): string {
  const ms = Date.now() + 10 * 60_000;
  const p = berlinParts(new Date(ms));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Rechnet die Sendezeiten für `count` Videos aus.
 * - `now`   → zehnmal SOFORT
 * - `slots` → abwechselnd 06:00 / 20:00 (Europe/Berlin), immer der nächste freie Zeitpunkt
 * - `flex`  → Startzeit + fester Abstand
 */
export function computeSlots(cfg: ShipConfig, count: number, nowMs: number = Date.now()): Slot[] {
  const out: Slot[] = [];
  const minFuture = nowMs + 2 * 60_000;

  if (cfg.mode === "now") {
    for (let i = 0; i < count; i++) out.push({ ms: null, wall: null, label: "SOFORT" });
    return out;
  }

  if (cfg.mode === "flex") {
    const interval = Math.max(1, cfg.flexIntervalMinutes) * 60_000;
    let start = parseDateTimeLocal(cfg.flexStart || defaultFlexStart());
    if (start === null) start = nowMs + 10 * 60_000;
    if (start <= minFuture) {
      /* Start liegt in der Vergangenheit → auf den nächsten freien Takt vorspulen */
      start += Math.ceil((minFuture - start) / interval) * interval;
    }
    for (let i = 0; i < count; i++) {
      const ms = start + i * interval;
      out.push({ ms, wall: msToBerlinWall(ms), label: formatSlotLabel(ms) });
    }
    return out;
  }

  /* slots: täglich 06:00 & 20:00 (anpassbar) */
  const times = (cfg.slotTimes.length ? cfg.slotTimes : DEFAULT_SHIP_CONFIG.slotTimes)
    .map((t) => parseTime(t))
    .filter((t): t is { hour: number; minute: number } => t !== null)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const slots = times.length ? times : [{ hour: 6, minute: 0 }, { hour: 20, minute: 0 }];

  const today = berlinParts(new Date(nowMs));
  for (let dayOffset = 0; out.length < count && dayOffset < 400; dayOffset++) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset, 12));
    const day = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
    };
    for (const time of slots) {
      if (out.length >= count) break;
      const ms = berlinWallToMs(day.year, day.month, day.day, time.hour, time.minute);
      if (ms <= minFuture) continue;
      out.push({ ms, wall: msToBerlinWall(ms), label: formatSlotLabel(ms) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  API-Aufrufe (same-origin → kein CORS, Key bleibt serverseitig)      */
/* ------------------------------------------------------------------ */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...gateHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(
      typeof data?.error === "string" ? data.error : `Zernio-Route HTTP ${res.status}`
    );
  }
  return data as T;
}

export async function fetchZernioStatus(): Promise<ZernioStatus> {
  try {
    const data = await call<{
      configured: boolean;
      accounts: ZernioAccount[];
      gate?: boolean;
    }>(`${ENDPOINT}?action=status`);
    return {
      ok: true,
      configured: Boolean(data?.configured),
      accounts: Array.isArray(data?.accounts) ? data.accounts : [],
      gate: Boolean(data?.gate),
    };
  } catch (e) {
    return {
      ok: false,
      configured: false,
      accounts: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key?: string;
  sig: string;
}

export function presignMedia(filename: string, contentType: string, size: number) {
  return call<PresignResponse>(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ action: "presign", filename, contentType, size }),
  });
}

export interface PublishInput {
  mediaUrl: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  content: string;
  title: string;
  hashtags: string[];
  tags?: string[];
  slot: Slot;
  asDraft: boolean;
  timezone?: string;
  platforms?: { platform: string; accountId?: string }[];
}

export function publishPost(input: PublishInput) {
  return call<{ postId: string | null; status: string; scheduledFor: string | null }>(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action: "publish",
      mediaUrl: input.mediaUrl,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      content: input.content,
      title: input.title,
      hashtags: input.hashtags,
      tags: input.tags ?? [],
      platforms: input.platforms ?? [],
      isDraft: input.asDraft,
      scheduledFor: input.slot.wall ?? undefined,
      timezone: input.slot.wall ? (input.timezone ?? SHIP_TIMEZONE) : undefined,
    }),
  });
}

export function fetchPostStatus(postId: string) {
  return call<{ postId: string; status: string }>(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ action: "post-status", postId }),
  });
}

/* ------------------------------------------------------------------ */
/*  Upload: Browser → Presigned URL (Fallback: Serverless-Relay)        */
/* ------------------------------------------------------------------ */

function xhrUpload(
  url: string,
  method: "PUT" | "POST",
  blob: Blob,
  headers: Record<string, string>,
  onProgress?: (ratio: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 600_000;
    for (const [key, value] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        /* ungültiger Header-Name — ignorieren */
      }
    }
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error(
            `Upload HTTP ${xhr.status}: ${String(xhr.responseText || "").slice(0, 180) || "ohne Antwort"}`
          )
        );
    };
    xhr.onerror = () => reject(new Error("__NETWORK__"));
    xhr.ontimeout = () => reject(new Error("Upload-Timeout nach 10 Minuten"));
    xhr.send(blob);
  });
}

/**
 * Lädt ein Video zu Zernio und liefert die öffentliche URL für den Post.
 * Primärweg: direkter PUT auf die Presigned-URL (bis 5 GB, kein Body-Limit).
 * Fallback: derselbe Upload über die eigene Serverless-Route, falls der
 * Storage-Host den Browser-Upload per CORS blockt (dann max. ~4 MB).
 */
export async function uploadVideoBlob(
  blob: Blob,
  filename: string,
  contentType: string,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const presign = await presignMedia(filename, contentType, blob.size);

  try {
    await xhrUpload(presign.uploadUrl, "PUT", blob, { "Content-Type": contentType }, onProgress);
    return presign.publicUrl;
  } catch (e) {
    const network = e instanceof Error && e.message === "__NETWORK__";
    if (!network) throw e instanceof Error ? e : new Error(String(e));
    if (blob.size > RELAY_MAX_BYTES) {
      throw new Error(
        `Der Video-Speicher hat den direkten Browser-Upload blockiert (CORS) und ${(
          blob.size / 1024 / 1024
        ).toFixed(1)} MB passen nicht durch den Relay (Limit 4,5 MB). Niedrigere Auflösung/Bitrate wählen (Settings → VIDEO) oder das Video per ZIP selbst hochladen.`
      );
    }
    await xhrUpload(
      UPLOAD_ENDPOINT,
      "POST",
      blob,
      {
        ...gateHeaders(),
        "x-sf-target": presign.uploadUrl,
        "x-sf-sig": presign.sig,
        "x-sf-content-type": contentType,
      },
      onProgress
    );
    return presign.publicUrl;
  }
}

/* ------------------------------------------------------------------ */
/*  Beschriftung + Versand eines einzelnen Videos                       */
/* ------------------------------------------------------------------ */

export const shipFileName = (item: LocalRenderItem) =>
  `shortsfactory_${String(item.index + 1).padStart(2, "0")}.${
    item.mime?.includes("webm") ? "webm" : "mp4"
  }`;

export function parseHashtags(raw: string): string[] {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function excerptOf(story: string, max = 240): string {
  const text = String(story || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}

export interface CaptionParts {
  content: string;
  title: string;
  hashtags: string[];
}

export function buildCaption(item: LocalRenderItem, cfg: ShipConfig): CaptionParts {
  const idea = (item.idea || "").trim();
  const hashtags = parseHashtags(cfg.hashtags);
  const override = (cfg.titleOverride || "").trim();
  const title = (override || idea || "Reddit Story").slice(0, 100);

  const content = (cfg.captionTemplate || DEFAULT_CAPTION_TEMPLATE)
    .replaceAll("{title}", title)
    .replaceAll("{idea}", idea)
    .replaceAll("{story}", (item.story || "").replace(/\s+/g, " ").trim())
    .replaceAll("{excerpt}", excerptOf(item.story || ""))
    .replaceAll("{hashtags}", hashtags.map((h) => `#${h}`).join(" "))
    .replaceAll("{index}", String(item.index + 1).padStart(2, "0"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { content: content.slice(0, 4000), title, hashtags };
}

export type ShipStage = "uploading" | "publishing";

export interface ShipHooks {
  slot: Slot;
  onStage?: (stage: ShipStage) => void;
  onProgress?: (ratio: number) => void;
}

export interface ShipResult {
  postId: string | null;
  status: string;
  scheduledFor: string | null;
  mediaUrl: string;
  slot: Slot;
}

export async function shipVideo(
  item: LocalRenderItem,
  cfg: ShipConfig,
  hooks: ShipHooks
): Promise<ShipResult> {
  if (!item.blob) throw new Error("Dieses Unit ist noch nicht gerendert.");

  const filename = shipFileName(item);
  const contentType = item.mime?.split(";")[0] || "video/mp4";

  hooks.onStage?.("uploading");
  const mediaUrl = await uploadVideoBlob(item.blob, filename, contentType, hooks.onProgress);

  hooks.onStage?.("publishing");
  const caption = buildCaption(item, cfg);
  const result = await publishPost({
    mediaUrl,
    filename,
    mimeType: contentType,
    size: item.blob.size,
    content: caption.content,
    title: caption.title,
    hashtags: caption.hashtags,
    tags: caption.hashtags,
    slot: hooks.slot,
    asDraft: cfg.asDraft,
  });

  return {
    postId: result.postId,
    status: result.status,
    scheduledFor: result.scheduledFor ?? hooks.slot.wall,
    mediaUrl,
    slot: hooks.slot,
  };
}

/** Wartet die Pflicht-Pause ab und meldet den Countdown (100-ms-Schritte). */
export async function shipGap(
  ms: number = SHIP_GAP_MS,
  onTick?: (remainingMs: number) => void,
  isCancelled?: () => boolean
): Promise<boolean> {
  const step = 100;
  for (let left = ms; left > 0; left -= step) {
    if (isCancelled?.()) return true;
    onTick?.(Math.max(0, left));
    await sleep(Math.min(step, left));
  }
  onTick?.(0);
  return Boolean(isCancelled?.());
}

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  twitter: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  reddit: "Reddit",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  googlebusiness: "Google Business",
  telegram: "Telegram",
  snapchat: "Snapchat",
  whatsapp: "WhatsApp",
  discord: "Discord",
  slack: "Slack",
};

export const platformLabel = (p: string) => PLATFORM_LABELS[p?.toLowerCase()] ?? p ?? "—";
