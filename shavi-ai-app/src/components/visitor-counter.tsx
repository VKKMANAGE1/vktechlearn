import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const API = String((window as unknown as { SHAVI_API?: string }).SHAVI_API || "").replace(/\/$/, "");
const FALLBACK_KEY = "shavi-visits-v1";
const START = 203234;

/**
 * Site-wide visitor counter.
 *
 * POST /api/visits ek hi D1 row badhata hai (203233 se shuru), isliye har visit aur
 * refresh par number ek aage badhta hai. Backend na mile to isi browser me ginne wala
 * fallback chalta hai, taaki widget kabhi khaali na dikhe.
 */
export function VisitorCounter() {
  const [count, setCount] = useState<number | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    let alive = true;
    fetch(API + "/api/visits", { method: "POST", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("offline"))))
      .then((data: { count?: number }) => {
        if (!alive) return;
        const value = Number(data?.count);
        setCount(Number.isFinite(value) && value > 0 ? value : START);
      })
      .catch(() => {
        if (!alive) return;
        let next = START;
        try {
          const saved = Number(localStorage.getItem(FALLBACK_KEY) || 0);
          next = (saved >= START ? saved : START - 1) + 1;
          localStorage.setItem(FALLBACK_KEY, String(next));
        } catch {
          /* private mode — sirf isi page ke liye */
        }
        setCount(next);
      });

    return () => {
      // StrictMode दोबारा mount करता है — दूसरे run को चलने दो, पहले का जवाब ignore हो जाए.
      alive = false;
      asked.current = false;
    };
  }, []);

  const digits = count === null ? "—" : count.toLocaleString("en-US");

  return (
    <div className="mt-4 flex justify-center">
      <span className="liquid-glass flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4 text-[0.65rem] text-white/60">
        <span className="flex size-5 items-center justify-center rounded-full bg-white/10">
          <Eye className="size-3" />
        </span>
        <span className="font-poppins tabular-nums tracking-[0.08em] text-white/90" aria-label="कुल विज़िटर">
          {digits.split("").map((char, index) => (
            <span className={char === "," ? "text-white/50" : "visit-digit"} key={`${index}-${char}`}>
              {char}
            </span>
          ))}
        </span>
        <span className="hidden text-[0.55rem] uppercase tracking-[0.22em] text-white/45 sm:inline">visitors</span>
        <span className="size-1 animate-[shavi-breathe_2.4s_ease-in-out_infinite] rounded-full bg-white/70" />
      </span>
    </div>
  );
}
