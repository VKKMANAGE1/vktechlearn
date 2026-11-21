import {
  ArrowRight,
  BookOpen,
  Instagram,
  Menu,
  Plus,
  Sparkles,
  Twitter,
  Wand2,
  Youtube,
} from "lucide-react";
import { ShaviMark } from "@/components/shavi-mark";

const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4";

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/shavi-ai/";

export type LandingAiState = "checking" | "online" | "demo" | "offline";

const STATUS: Record<LandingAiState, string> = {
  checking: "जाँच रहा हूँ…",
  online: "AI ऑनलाइन",
  demo: "डेमो मोड",
  offline: "ऑफ़लाइन",
};

/** App ka home screen — liquid glass hero over the looping video. */
export function Landing({
  aiState,
  onFocusInput,
  onOpenMenu,
  onPick,
}: {
  aiState: LandingAiState;
  onFocusInput: () => void;
  onOpenMenu: () => void;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090a]">
      <video
        aria-hidden
        autoPlay
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
        disablePictureInPicture
        loop
        muted
        playsInline
        preload="auto"
        src={VIDEO}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-black/25" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-full w-full flex-col lg:flex-row">

          {/* ---------- Left panel ---------- */}
          <section className="relative flex w-full flex-col lg:w-[52%]">
            <div className="liquid-glass-strong m-3 flex flex-1 flex-col rounded-3xl px-6 py-6 lg:m-5 lg:px-12 lg:py-9">

              {/* Nav */}
              <nav className="flex items-center justify-between">
                <button
                  aria-label="ShâVì Ai होम"
                  className="flex items-center"
                  onClick={onFocusInput}
                  type="button"
                >
                  <ShaviMark className="text-[1.35rem]" />
                </button>
                <button
                  className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/80 transition-transform hover:scale-105 active:scale-95"
                  onClick={onOpenMenu}
                  type="button"
                >
                  <Menu className="size-4" />
                  <span>मेन्यू</span>
                </button>
              </nav>

              {/* Hero */}
              <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                <ShaviMark className="mb-6 text-[2.3rem]" />

                <h1 className="font-poppins max-w-xl text-[2.6rem] font-medium leading-[0.95] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                  Intelligence that
                  <br />
                  <em className="font-source italic text-white/80">speaks your</em> language
                </h1>

                <p className="mt-5 max-w-md text-sm leading-relaxed text-white/50">
                  कोडिंग, पढ़ाई, लिखाई, अनुवाद, रिसर्च और दस्तावेज़ — हिंदी या English, बिना लॉगिन, बिल्कुल मुफ़्त।
                </p>

                <button
                  className="liquid-glass-strong mt-8 flex items-center gap-3 rounded-full py-2 pl-6 pr-2 text-sm text-white transition-transform hover:scale-105 active:scale-95"
                  onClick={onFocusInput}
                  type="button"
                >
                  <span className="font-poppins tracking-tight">चैट शुरू करें</span>
                  <span className="flex size-7 items-center justify-center rounded-full bg-white/15">
                    <ArrowRight className="size-3.5" />
                  </span>
                </button>

                <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                  <a
                    className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 transition-transform hover:scale-105"
                    href="/pdf/"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    PDF टूल्स
                  </a>
                  <a
                    className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 transition-transform hover:scale-105"
                    href="/img/"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    इमेज टूल्स
                  </a>
                  <button
                    className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 transition-transform hover:scale-105"
                    onClick={onOpenMenu}
                    type="button"
                  >
                    चैट इतिहास
                  </button>
                </div>
              </div>

              {/* Quote */}
              <div className="space-y-3 text-center">
                <p className="text-[0.7rem] uppercase tracking-widest text-white/50">
                  मुफ़्त · बिना लॉगिन · हिंदी + English
                </p>
                <p className="mx-auto max-w-sm text-lg leading-snug text-white/80">
                  <span className="font-poppins">Every answer begins with a </span>
                  <span className="font-source italic">question.</span>
                </p>
                <div className="flex items-center justify-center gap-3 pt-1">
                  <span className="h-px w-10 bg-white/20" />
                  <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/50">VK Tech Learn</span>
                  <span className="h-px w-10 bg-white/20" />
                </div>
              </div>
            </div>
          </section>

          {/* ---------- Right panel ---------- */}
          <aside className="hidden w-[48%] flex-col p-5 lg:flex">

            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div className="liquid-glass flex items-center gap-1 rounded-full p-1.5">
                <a
                  aria-label="Twitter / X"
                  className="flex size-8 items-center justify-center rounded-full text-white transition-colors hover:text-white/80"
                  href="https://twitter.com/VkLearn"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Twitter className="size-4" />
                </a>
                <a
                  aria-label="Instagram"
                  className="flex size-8 items-center justify-center rounded-full text-white transition-colors hover:text-white/80"
                  href="https://www.instagram.com/vktechlearn/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Instagram className="size-4" />
                </a>
                <a
                  aria-label="YouTube"
                  className="flex size-8 items-center justify-center rounded-full text-white transition-colors hover:text-white/80"
                  href="https://www.youtube.com/channel/UCxNF19OLq9Mcuzh4pcKOkXA"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Youtube className="size-4" />
                </a>
                <a
                  aria-label="वेबसाइट खोलें"
                  className="ml-1 flex size-8 items-center justify-center rounded-full bg-white/10 text-white transition-transform hover:scale-105"
                  href="/"
                >
                  <ArrowRight className="size-4" />
                </a>
              </div>

              <div className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-white/80">
                <Sparkles className="size-4" />
                <span>{STATUS[aiState]}</span>
              </div>
            </div>

            {/* Community card */}
            <div className="liquid-glass mt-8 ml-auto w-56 rounded-3xl p-4">
              <p className="font-poppins text-sm font-medium text-white">हमारा इकोसिस्टम</p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/50">
                PDF, इमेज, कोडिंग और YouTube टूल्स — एक ही जगह, बिल्कुल मुफ़्त।
              </p>
              <a
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/80 transition-colors hover:text-white"
                href="/"
              >
                सभी टूल्स देखें
                <ArrowRight className="size-3" />
              </a>
            </div>

            {/* Feature section */}
            <div className="liquid-glass mt-auto rounded-[2.5rem] p-4">
              <div className="grid grid-cols-2 gap-4">
                <button
                  className="liquid-glass rounded-3xl p-4 text-left transition-transform hover:scale-105 active:scale-95"
                  onClick={() => onPick("मेरी पढ़ाई के लिए एक 7-दिन का प्लान बनाओ।")}
                  type="button"
                >
                  <span className="mb-4 flex size-8 items-center justify-center rounded-full bg-white/10">
                    <Wand2 className="size-4" />
                  </span>
                  <p className="font-poppins text-sm font-medium text-white">AI जनरेशन</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/50">
                    इमेज बनाएँ, लिखावट सुधारें और नए आइडिया तुरंत पाएँ।
                  </p>
                </button>

                <button
                  className="liquid-glass rounded-3xl p-4 text-left transition-transform hover:scale-105 active:scale-95"
                  onClick={onOpenMenu}
                  type="button"
                >
                  <span className="mb-4 flex size-8 items-center justify-center rounded-full bg-white/10">
                    <BookOpen className="size-4" />
                  </span>
                  <p className="font-poppins text-sm font-medium text-white">चैट इतिहास</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/50">
                    हर बातचीत इसी ब्राउज़र में सहेजी जाती है — कभी भी वापस पढ़ें।
                  </p>
                </button>
              </div>

              <div className="liquid-glass mt-4 flex items-center gap-4 rounded-3xl p-3">
                <img
                  alt="Liquid glass ऐब्सट्रैक्ट बैकग्राउंड"
                  className="h-16 w-24 shrink-0 rounded-xl object-cover"
                  height={64}
                  src={BASE + "landing-ai.png"}
                  width={96}
                />
                <div className="min-w-0">
                  <p className="font-poppins text-sm font-medium text-white">दस्तावेज़ एक्सपोर्ट</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">
                    जवाब PDF, Word, Excel या PowerPoint में डाउनलोड करें।
                  </p>
                </div>
                <button
                  aria-label="नई चैट शुरू करें"
                  className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-transform hover:scale-105 active:scale-95"
                  onClick={onFocusInput}
                  type="button"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          </aside>

        </div>
      </div>
    </div>
  );
}
