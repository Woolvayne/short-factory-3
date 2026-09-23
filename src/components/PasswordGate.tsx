import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Factory, KeyRound, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "../utils/cn";
import { gateInfo, verifyPassword } from "../lib/gate";

const MAX_TRIES = 5;
const LOCKOUT_MS = 15_000;

/**
 * The one-page password screen. It is the ONLY thing that renders until the
 * visitor types the password that was baked into the build via a Vercel
 * environment variable — the factory behind it is never mounted.
 */
export default function PasswordGate({
  onUnlock,
}: {
  onUnlock: (token: string, remember: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [shake, setShake] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const info = gateInfo();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [lockedUntil]);

  const lockoutLeft = Math.max(0, lockedUntil - now);

  const submit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (checking || lockoutLeft > 0) return;
      if (!value) {
        setError("BITTE PASSWORT EINGEBEN.");
        setShake(true);
        window.setTimeout(() => setShake(false), 500);
        return;
      }
      setChecking(true);
      setError(null);
      try {
        const token = await verifyPassword(value);
        if (token === null) {
          setShake(true);
          window.setTimeout(() => setShake(false), 500);
          const next = tries + 1;
          setTries(next);
          setValue("");
          if (next >= MAX_TRIES) {
            setLockedUntil(Date.now() + LOCKOUT_MS);
            setNow(Date.now());
            setTries(0);
            setError(`${MAX_TRIES} FEHLVERSUCHE — KURZE PAUSE, DANN NOCHMAL.`);
          } else {
            setError(`FALSCHES PASSWORT · ${MAX_TRIES - next} VERSUCH${MAX_TRIES - next === 1 ? "" : "E"} ÜBRIG`);
          }
          inputRef.current?.focus();
        } else {
          onUnlock(token, remember);
        }
      } catch (e) {
        setShake(true);
        window.setTimeout(() => setShake(false), 500);
        setError(e instanceof Error ? e.message.toUpperCase() : "PRÜFUNG FEHLGESCHLAGEN");
      } finally {
        setChecking(false);
      }
    },
    [checking, lockoutLeft, value, tries, onUnlock]
  );

  return (
    <div className="grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-coal-950 px-4 py-10">
      <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-90" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden">
        <div className="h-14 w-full animate-scan bg-gradient-to-b from-transparent via-ember-500/[0.10] to-transparent" />
      </div>
      <div className="animate-pulse-heat pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,138,31,0.18),transparent_68%)] blur-2xl" />

      <div className="relative z-10 w-full max-w-[460px]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="bg-heat grid size-11 shrink-0 place-items-center text-coal-950 shadow-[0_0_28px_-4px_var(--color-ember-500)]">
            <Factory className="size-6" strokeWidth={2.2} />
          </div>
          <div className="leading-none">
            <div className="font-display text-lg font-black tracking-tight">
              SHORTS<span className="text-heat">FACTORY</span>
            </div>
            <div className="mono-label mt-1.5 text-[9px] text-coal-400">
              LOCAL VIDEO ASSEMBLY · v3
            </div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className={cn(
            "card-bracket border border-coal-700 p-6 sm:p-7",
            shake && "animate-shake"
          )}
        >
          <div className="mb-5 flex items-center gap-2.5">
            <Lock className="size-4 shrink-0 text-volt-400" />
            <h1 className="font-display text-sm font-black tracking-[0.14em] text-paper-100 uppercase">
              Zugang geschützt
            </h1>
          </div>
          <p className="mb-6 font-mono text-[11px] leading-relaxed text-coal-300">
            Diese Fabrik ist privat. Passwort eingeben — es wird gegen einen SHA-256-Hash aus der
            Vercel-Environment-Variable geprüft. Kein Backend, keine Datenbank.
          </p>

          <label className="block">
            <span className="mono-label mb-1.5 block text-[9px] text-coal-400">PASSWORT</span>
            <span
              className={cn(
                "flex items-stretch border bg-coal-850 transition-colors focus-within:border-volt-400/70",
                error ? "border-rose-err/70" : "border-coal-600"
              )}
            >
              <span className="grid w-11 place-items-center border-r border-coal-700 text-coal-400">
                <KeyRound className="size-3.5" />
              </span>
              <input
                ref={inputRef}
                type={show ? "text" : "password"}
                value={value}
                disabled={checking || lockoutLeft > 0}
                onChange={(e) => setValue(e.target.value)}
                placeholder="••••••••••"
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[13px] tracking-wider text-paper-100 placeholder:text-coal-600 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="grid w-11 place-items-center border-l border-coal-700 text-coal-400 hover:text-volt-300"
                aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
              >
                {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </span>
          </label>

          <button
            type="button"
            onClick={() => setRemember((r) => !r)}
            className="mt-3 flex w-full items-center justify-between gap-3 border border-coal-700/80 bg-coal-850 px-3 py-2 text-left"
            aria-pressed={remember}
          >
            <span className="font-mono text-[10px] font-bold tracking-widest text-coal-300">
              ANGEMELDET BLEIBEN
            </span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 border transition-colors",
                remember ? "border-volt-400 bg-volt-400/30" : "border-coal-600 bg-coal-800"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-3.5 transition-all",
                  remember ? "left-[18px] bg-volt-400" : "left-0.5 bg-coal-500"
                )}
              />
            </span>
          </button>
          <p className="mt-1.5 font-mono text-[8.5px] leading-relaxed tracking-wider text-coal-500">
            {remember
              ? "WIRD IN DIESEM BROWSER DAUERHAFT GESPEICHERT (LOCALSTORAGE)."
              : "GILT NUR FÜR DIESEN TAB (SESSIONSTORAGE) — SICHERER AUF FREMDEN GERÄTEN."}
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
              <p className="font-mono text-[10.5px] leading-relaxed text-rose-err">
                {error}
                {lockoutLeft > 0 && (
                  <span className="mt-1 block text-paper-100">
                    WEITER IN {(lockoutLeft / 1000).toFixed(1)} s
                  </span>
                )}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={checking || lockoutLeft > 0}
            className={cn(
              "glow-volt bg-heat mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 border border-volt-400 font-display text-base font-black tracking-tight text-coal-950 uppercase disabled:opacity-60",
              !checking && lockoutLeft === 0 && "hover:opacity-95"
            )}
          >
            {checking ? "PRÜFE…" : lockoutLeft > 0 ? "WARTEN…" : "Fabrik entsperren"}
          </button>

          <div className="mt-5 flex items-start gap-2 border border-coal-700/70 bg-coal-950/40 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-coal-400" />
            <p className="font-mono text-[9.5px] leading-relaxed text-coal-400">
              {info.hint} Passwort ändern: Environment-Variable in Vercel anpassen → neu deployen.
              Schritt-für-Schritt: <span className="text-volt-300">docs/ANLEITUNG.md</span>
            </p>
          </div>
        </form>

        <p className="mt-5 text-center font-mono text-[9px] tracking-[0.18em] text-coal-500">
          KEIN BACKEND · KEIN TRACKING · DEINE DATEIEN BLEIBEN AUF DEM GERÄT
        </p>
      </div>
    </div>
  );
}
