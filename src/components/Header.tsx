import { useEffect, useState } from "react";
import { Calendar, Factory } from "lucide-react";
import { cn } from "../utils/cn";
import type { Phase } from "../lib/types";

function Led({ on, tone = "volt" }: { on: boolean; tone?: "volt" | "ember" }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full",
        tone === "volt" ? "text-volt-400" : "text-ember-500",
        on ? "animate-led bg-current" : "bg-coal-600"
      )}
    />
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="font-mono text-[11px] tracking-widest text-coal-300 tabular-nums">
      {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())} LOCAL
    </span>
  );
}

const MARQUEE_ITEMS = [
  "10 IDEAS IN — 10 SHORTS OUT",
  "AI-WRITTEN TITLES",
  "100 % IN-BROWSER",
  "EDGE READ-ALOUD WEBSOCKET VOICE",
  "WORD-SYNCED CAPTIONS",
  "CANVAS + MEDIARECORDER RENDER",
  "YOUR FILES NEVER LEAVE THE DEVICE",
  "9:16 VERTICAL · SAFARI READY",
  "ZIP DELIVERY",
];

export default function Header({
  phase,
  keyed,
  activeView,
  onViewChange,
  scheduledCount,
}: {
  phase: Phase;
  keyed: boolean;
  activeView: "factory" | "calendar";
  onViewChange: (view: "factory" | "calendar") => void;
  scheduledCount: number;
}) {
  const running = phase === "preparing" || phase === "rendering";
  return (
    <header className="relative z-40">
      <div className="border-b border-coal-700/70 bg-coal-950/90">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-heat grid size-9 shrink-0 place-items-center text-coal-950 shadow-[0_0_22px_-4px_var(--color-ember-500)]">
              <Factory className="size-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 leading-none">
              <div className="truncate font-display text-[15px] font-black tracking-tight">
                SHORTS<span className="text-heat">FACTORY</span>
              </div>
              <div className="mono-label mt-1 text-[9px] text-coal-400">
                LOCAL VIDEO ASSEMBLY · v2
              </div>
            </div>
          </div>

          {/* Primary Navigation: Factory vs. Kalender */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onViewChange("factory")}
              className={cn(
                "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest transition-colors",
                activeView === "factory"
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
              )}
            >
              <Factory className="size-3.5" /> Factory
            </button>
            <button
              type="button"
              onClick={() => onViewChange("calendar")}
              className={cn(
                "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest transition-colors",
                activeView === "calendar"
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
              )}
            >
              <Calendar className="size-3.5" /> 📅 Kalender
              {scheduledCount > 0 && (
                <span
                  className={cn(
                    "ml-1 rounded-full px-1.5 py-px font-mono text-[9px] font-bold",
                    activeView === "calendar"
                      ? "bg-coal-950 text-volt-300"
                      : "bg-volt-400 text-coal-950"
                  )}
                >
                  {scheduledCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            <div className="hidden items-center gap-2 sm:flex">
              <Led on={keyed} />
              <span className="mono-label text-[9px] text-coal-300">
                {keyed ? "AI SCRIPT" : "OFFLINE SCRIPT"}
              </span>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Led on />
              <span className="mono-label text-[9px] text-coal-300">TTS SOCKET</span>
            </div>
            <div className="flex items-center gap-2">
              <Led on={running} tone={running ? "ember" : "volt"} />
              <span className="mono-label text-[9px] text-coal-300">CANVAS REC</span>
            </div>
            <div className="hidden h-4 w-px bg-coal-700 md:block" />
            <div className="hidden md:block">
              <Clock />
            </div>
          </div>
        </div>
      </div>

      {/* marquee strip */}
      <div className="bg-heat relative overflow-hidden border-b border-coal-700/70">
        <div className="flex w-max animate-marquee items-center gap-0 py-1.5 whitespace-nowrap">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
              {MARQUEE_ITEMS.map((item, i) => (
                <span
                  key={`${copy}-${i}`}
                  className="mx-5 font-mono text-[10px] font-bold tracking-[0.22em] text-coal-950"
                >
                  {item} <span className="ml-5 opacity-40">///</span>
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-coal-950/20" />
      </div>
    </header>
  );
}
