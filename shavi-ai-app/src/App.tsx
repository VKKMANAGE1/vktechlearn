import { useChat } from "@ai-sdk/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  Copy,
  Download,
  Menu,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import logoDark from "@/assets/shavi-logo.png";
import logoLight from "@/assets/shavi-logo-light.png";

const API = String((window as unknown as { SHAVI_API?: string }).SHAVI_API || "").replace(/\/$/, "");
const STORE = "shavi-ai-threads-v1";
const NEW_TITLE = "नई चैट";

type Thread = { id: string; title: string; messages: UIMessage[]; updatedAt: number };
type AiState = "checking" | "online" | "demo" | "offline";

/** Backend se aane wale simple SSE ({delta}) ko AI SDK ke UI stream me badalta hai. */
class ShaviTransport implements ChatTransport<UIMessage> {
  async sendMessages({
    messages,
    abortSignal,
  }: {
    messages: UIMessage[];
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const payload = messages
      .map((message) => ({
        role: message.role,
        content: message.parts
          .filter((part) => part.type === "text")
          .map((part) => (part as { text: string }).text)
          .join(""),
      }))
      .filter((message) => message.content.trim().length > 0)
      .slice(-10);

    const response = await fetch(API + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: payload }),
      signal: abortSignal,
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}) as { error?: string });
      throw new Error(data.error || "AI सेवा से जवाब नहीं आया (HTTP " + response.status + ")");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const textId = "text-1";

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        let buffer = "";
        let started = false;
        const emit = (chunk: UIMessageChunk) => controller.enqueue(chunk);
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith("data:")) continue;
              let data: { delta?: string; error?: string };
              try {
                data = JSON.parse(line.slice(5).trim());
              } catch {
                continue;
              }
              if (data.error) emit({ type: "error", errorText: String(data.error) });
              if (data.delta) {
                if (!started) {
                  emit({ type: "text-start", id: textId });
                  started = true;
                }
                emit({ type: "text-delta", id: textId, delta: data.delta });
              }
            }
          }
          if (!started) {
            emit({ type: "text-start", id: textId });
            emit({ type: "text-delta", id: textId, delta: "खाली जवाब मिला — दोबारा कोशिश करें।" });
          }
          emit({ type: "text-end", id: textId });
        } catch (error) {
          if ((error as Error)?.name !== "AbortError") {
            emit({ type: "error", errorText: (error as Error)?.message || "नेटवर्क में गड़बड़ी" });
          }
        }
        controller.close();
      },
      cancel() {
        void reader.cancel();
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

function loadThreads(): Thread[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((thread) => thread && Array.isArray(thread.messages));
  } catch {
    return [];
  }
}

function saveThreads(threads: Thread[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(threads.slice(0, 50)));
  } catch {
    /* storage full or blocked — chat still works for this session */
  }
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState("");
  const [filter, setFilter] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [dark, setDark] = useState(true);
  const [aiState, setAiState] = useState<AiState>("checking");

  useEffect(() => {
    let alive = true;
    fetch(API + "/health", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("offline"))))
      .then((data: { demo?: boolean }) => alive && setAiState(data.demo ? "demo" : "online"))
      .catch(() => alive && setAiState("offline"));
    return () => {
      alive = false;
    };
  }, []);

  const active = threads.find((thread) => thread.id === activeId) || null;

  const persist = useCallback(
    (messages: UIMessage[]) => {
      if (!messages.length) return;
      setThreads((current) => {
        const id = activeId;
        if (!id) return current;
        const firstUser = messages.find((message) => message.role === "user");
        const firstText =
          firstUser?.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text: string }).text)
            .join("") || "";
        const next = current.map((thread) =>
          thread.id === id
            ? {
                ...thread,
                title: thread.title === NEW_TITLE && firstText ? firstText.slice(0, 54) : thread.title,
                messages,
                updatedAt: Date.now(),
              }
            : thread,
        );
        saveThreads(next);
        return next;
      });
    },
    [activeId],
  );

  function newChat() {
    setActiveId(null);
    setPending("");
    setSidebar(false);
  }

  function startWith(text: string) {
    const thread: Thread = {
      id: (crypto.randomUUID?.() || String(Date.now())).slice(0, 36),
      title: NEW_TITLE,
      messages: [],
      updatedAt: Date.now(),
    };
    setThreads((current) => {
      const next = [thread, ...current];
      saveThreads(next);
      return next;
    });
    setActiveId(thread.id);
    setPending(text);
  }

  function remove(id: string) {
    setThreads((current) => {
      const next = current.filter((thread) => thread.id !== id);
      saveThreads(next);
      return next;
    });
    if (id === activeId) setActiveId(null);
  }

  function rename(id: string, oldTitle: string) {
    const next = window.prompt("चैट का नाम बदलें", oldTitle)?.trim();
    if (!next) return;
    setThreads((current) => {
      const updated = current.map((thread) => (thread.id === id ? { ...thread, title: next } : thread));
      saveThreads(updated);
      return updated;
    });
  }

  function toggleTheme() {
    const isDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);
  }

  const visible = threads.filter((thread) => thread.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <Toaster position="top-center" theme={dark ? "dark" : "light"} />
      {sidebar && (
        <Button
          aria-label="साइडबार बंद करें"
          className="fixed inset-0 z-30 h-auto w-auto rounded-none bg-foreground/40 lg:hidden"
          variant="ghost"
          onClick={() => setSidebar(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:static lg:translate-x-0 ${
          sidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <button className="flex items-center" onClick={newChat} aria-label="ShâVì Ai होम">
            <img alt="ShâVì Ai" className="h-9 w-auto dark:hidden" src={logoDark} />
            <img alt="ShâVì Ai" className="hidden h-9 w-auto dark:block" src={logoLight} />
          </button>
          <Button
            aria-label="साइडबार बंद करें"
            className="lg:hidden"
            size="icon-sm"
            variant="ghost"
            onClick={() => setSidebar(false)}
          >
            <X />
          </Button>
        </div>

        <div className="px-3">
          <Button className="h-10 w-full justify-start" onClick={newChat}>
            <Plus /> नई चैट
          </Button>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="चैट खोजें"
              className="h-9 bg-background/50 pl-9"
              placeholder="चैट खोजें"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto px-2">
          <p className="px-2 pb-2 text-xs font-semibold uppercase text-muted-foreground">आपकी चैट</p>
          {visible.length === 0 && (
            <p className="px-3 text-sm text-muted-foreground">अभी कोई चैट नहीं — नई चैट शुरू करें।</p>
          )}
          {visible.map((thread) => (
            <div
              className={`group mb-1 flex items-center rounded-md ${
                thread.id === activeId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
              }`}
              key={thread.id}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-sm"
                onClick={() => {
                  setActiveId(thread.id);
                  setSidebar(false);
                }}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{thread.title}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="चैट विकल्प"
                    className="mr-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => rename(thread.id, thread.title)}>
                    <Pencil /> नाम बदलें
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => remove(thread.id)}>
                    <Trash2 /> हटाएँ
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-3 space-y-1 px-2 text-xs text-muted-foreground">
            <a
              className="flex items-center gap-1.5 underline-offset-4 hover:text-sidebar-foreground hover:underline"
              href="/"
            >
              <ArrowLeft className="size-3.5" /> वेबसाइट पर लौटें
            </a>
            <p className="pt-1">
              by <span className="font-semibold text-sidebar-foreground">Vïnâý Kúshwâhå</span>
            </p>
            <p>© 2026 VK Tech Learn</p>
          </div>
          <Button className="w-full justify-start" variant="ghost" onClick={toggleTheme}>
            {dark ? <Sun /> : <Moon />}
            {dark ? "लाइट मोड" : "डार्क मोड"}
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="साइडबार खोलें"
              className="lg:hidden"
              size="icon-sm"
              variant="ghost"
              onClick={() => setSidebar(true)}
            >
              <Menu />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-sm font-semibold sm:text-base">
                {active ? active.title : NEW_TITLE}
              </h1>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`size-1.5 rounded-full ${
                    aiState === "offline" ? "bg-destructive" : "bg-primary"
                  }`}
                />
                {aiState === "offline"
                  ? "AI सेवा जुड़ी नहीं"
                  : aiState === "demo"
                    ? "डेमो मोड — key सेट नहीं"
                    : "ShâVì Ai"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground sm:flex">
              <Check className="size-3.5 text-primary" />
              मुफ़्त · बिना लॉगिन
            </div>
          </div>
        </header>

        {aiState === "offline" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="grid size-14 place-items-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive">
              <BrainCircuit className="size-7" />
            </div>
            <h2 className="font-display text-2xl font-semibold">AI सेवा अभी जुड़ी नहीं है</h2>
            <p className="max-w-md leading-7 text-muted-foreground">
              बैकएंड तैयार होते ही यह पेज अपने आप चालू हो जाएगा। तब तक आप साइट के PDF और इमेज टूल्स
              इस्तेमाल कर सकते हैं।
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <a href="/pdf/">PDF टूल्स</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/img/">इमेज टूल्स</a>
              </Button>
              <Button asChild variant="ghost">
                <a href="/contact.html">संपर्क</a>
              </Button>
            </div>
          </div>
        ) : (
          <ChatView
            key={active ? active.id : "home"}
            thread={active}
            pending={pending}
            onPendingDone={() => setPending("")}
            onPersist={persist}
            onStart={startWith}
          />
        )}
      </main>
    </div>
  );
}

function ChatView({
  thread,
  pending,
  onPendingDone,
  onPersist,
  onStart,
}: {
  thread: Thread | null;
  pending: string;
  onPendingDone: () => void;
  onPersist: (messages: UIMessage[]) => void;
  onStart: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(() => new ShaviTransport(), []);
  const sent = useRef(false);
  const { messages, sendMessage, status, stop, error } = useChat({
    id: thread?.id ?? "home",
    messages: thread?.messages ?? [],
    transport,
    onError: (err) => toast.error(err.message),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (busy) return;
    if (messages.length) onPersist(messages);
  }, [busy, messages, onPersist]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [status]);

  useEffect(() => {
    if (!pending || sent.current) return;
    sent.current = true;
    void sendMessage({ text: pending });
    onPendingDone();
  }, [pending, sendMessage, onPendingDone]);

  function submit({ text }: { text: string }) {
    const value = text.trim();
    if (!value || busy) return;
    if (!thread) {
      onStart(value);
      return;
    }
    setInput("");
    void sendMessage({ text: value });
  }

  function pickPrompt(text: string) {
    if (thread) submit({ text });
    else onStart(text);
  }

  function exportChat() {
    const markdown = messages
      .map(
        (message) =>
          `## ${message.role === "user" ? "You" : "ShâVì Ai"}\n\n` +
          message.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text: string }).text)
            .join(""),
      )
      .join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    const name = (thread?.title || "chat").replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 40) || "chat";
    anchor.href = url;
    anchor.download = `${name}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="flex shrink-0 justify-end px-4 pt-2 sm:px-6">
        {messages.length > 0 && (
          <Button aria-label="चैट डाउनलोड करें" size="icon-sm" variant="ghost" onClick={exportChat}>
            <Download className="size-4" />
          </Button>
        )}
      </div>
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <Welcome onPick={pickPrompt} />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id} className="animate-rise-in">
                <MessageContent>
                  {message.parts.map((part, index) =>
                    part.type === "text" ? (
                      <MessageResponse key={index}>{part.text}</MessageResponse>
                    ) : part.type === "reasoning" ? (
                      <details className="text-xs text-muted-foreground" key={index}>
                        <summary className="cursor-pointer font-medium">सोचने की प्रक्रिया</summary>
                        <div className="mt-2 border-l border-border pl-3">
                          <MessageResponse>{part.text}</MessageResponse>
                        </div>
                      </details>
                    ) : null,
                  )}
                </MessageContent>
                {message.role === "assistant" && (
                  <MessageActions>
                    <MessageAction
                      tooltip="कॉपी"
                      onClick={() => {
                        const text = message.parts
                          .filter((part) => part.type === "text")
                          .map((part) => (part as { text: string }).text)
                          .join("");
                        void navigator.clipboard.writeText(text);
                        toast.success("कॉपी हो गया");
                      }}
                    >
                      <Copy />
                    </MessageAction>
                  </MessageActions>
                )}
              </Message>
            ))
          )}
          {status === "submitted" && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <BrainCircuit className="size-5 text-primary" />
              <Shimmer>सोच रहा हूँ…</Shimmer>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 bg-background px-3 pb-4 pt-2 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <PromptInput className="border-border bg-card shadow-lg" onSubmit={submit}>
            <PromptInputTextarea
              ref={inputRef}
              placeholder="ShâVì Ai से कुछ भी पूछें…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <PromptInputFooter>
              <PromptInputTools>
                <span className="px-2 text-xs text-muted-foreground">
                  Enter से भेजें · Shift + Enter से नई लाइन
                </span>
              </PromptInputTools>
              <PromptInputSubmit disabled={!input.trim() && !busy} onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            AI गलत भी हो सकता है — ज़रूरी बात जाँच लें ·{" "}
            <a className="underline-offset-2 hover:underline" href="/privacy-policy.html">
              Privacy
            </a>{" "}
            ·{" "}
            <a className="underline-offset-2 hover:underline" href="/terms-conditions.html">
              Terms
            </a>
          </p>
        </div>
      </div>
    </>
  );
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  const prompts = [
    "PDF को Word में कैसे बदलें?",
    "इमेज का साइज़ कम कैसे करें?",
    "लैपटॉप स्लो क्यों हो गया?",
    "10वीं के बाद क्या करें?",
  ];
  return (
    <ConversationEmptyState className="min-h-[58vh]">
      <div className="grid size-14 place-items-center rounded-md border border-primary/30 bg-accent text-primary">
        <BrainCircuit className="size-7" />
      </div>
      <div className="mt-3 max-w-lg">
        <h2 className="font-display text-3xl font-semibold">नमस्ते, मैं ShâVì Ai हूँ</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          हिंदी में कुछ भी पूछें — पढ़ाई, कोडिंग, लेखन, मोबाइल या PDF/इमेज टूल्स। बिना लॉगिन, बिल्कुल मुफ़्त।
        </p>
      </div>
      <div className="mt-7 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {prompts.map((prompt) => (
          <Button
            className="h-auto justify-start whitespace-normal px-4 py-3 text-left"
            key={prompt}
            variant="outline"
            onClick={() => onPick(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </ConversationEmptyState>
  );
}
