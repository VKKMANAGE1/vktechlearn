/* Login / Sign up page — पहचान Google account से (Google Identity Services ID token).
 *
 * बहाव:
 *   Google बटन → ID token (JWT) → POST /api/auth/google/idtoken → login token (localStorage)
 *   → Studio खुलता है. Server पर ID token की signature Google की public keys से जाँची जाती है,
 *   इसलिए client secret की ज़रूरत नहीं — सिर्फ़ public client ID.
 * studio (app.js) logged out होने पर इसी page पर भेजता है, इसलिए पहले login, फिर Studio.
 */
const API_BASE = "https://site-d28594350583452e987524c38e89b7a9.freebuff.page";
const LOGIN_KEY = "shavi-yt-login-v1";
const $ = (id) => document.getElementById(id);

const COPY = {
  login: {
    title: "अपने खाते में login करें",
    sub: "Google से जारी रखें — एक क्लिक, कोई नया password नहीं. आपकी keys और channel पहले से सेव मिलेंगी.",
    label: "Google से लॉग इन करें",
  },
  signup: {
    title: "नया खाता बनाएँ",
    sub: "Google से sign up — बस एक क्लिक. फिर Studio में अपनी keys एक बार सेव करनी हैं.",
    label: "Google से साइन अप करें",
  },
};

const params = new URLSearchParams(location.search);
let mode = params.get("mode") === "signup" ? "signup" : "login";
let clientId = "";

/** studio का वही URL जहाँ login के बाद जाना है (सिर्फ़ अपनी साइट के origins). */
function returnUrl() {
  const raw = params.get("return") || "";
  try {
    const target = new URL(raw, location.href);
    const own =
      target.origin === location.origin ||
      /^https:\/\/(www\.)?vktechlearn\.site$/.test(target.origin) ||
      /\.(freebuff\.page|style\.dev)$/.test(target.hostname) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(target.origin);
    if (own) return target.toString();
  } catch {
    /* नीचे default */
  }
  return location.href.replace(/login\.html(\?.*)?$/, "");
}

const back = returnUrl();

function say(text, kind = "") {
  $("authState").textContent = text || "";
  $("authState").className = `status ${kind}`;
}

function paint() {
  $("authTitle").textContent = COPY[mode].title;
  $("authSub").textContent = COPY[mode].sub;
  $("googleLabel").textContent = COPY[mode].label;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabSignup").classList.toggle("active", mode === "signup");
  $("tabLogin").setAttribute("aria-selected", String(mode === "login"));
  $("tabSignup").setAttribute("aria-selected", String(mode === "signup"));
  if (clientId && window.google?.accounts?.id) renderGoogleButton();
}

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google का script load नहीं हुआ — internet/adblock देखें"));
    document.head.appendChild(script);
  });
}

async function onCredential(response) {
  const credential = response?.credential;
  if (!credential) {
    say("Google से जवाब नहीं आया — दोबारा कोशिश करें", "error");
    return;
  }
  say("Google से आ गया — login हो रहा है…");
  try {
    const res = await fetch(`${API_BASE}/api/auth/google/idtoken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) throw new Error(data.error || `HTTP ${res.status}`);
    localStorage.setItem(LOGIN_KEY, data.token);
    say(`✓ ${data.user?.email || "login हो गया"} — Studio खुल रहा है…`, "ok");
    setTimeout(() => location.replace(back), 350);
  } catch (error) {
    say(error.message, "error");
  }
}

async function renderGoogleButton() {
  try {
    await loadGis();
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: onCredential,
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    $("gisBox").innerHTML = "";
    window.google.accounts.id.renderButton($("gisBox"), {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      text: mode === "signup" ? "signup_with" : "signin_with",
      logo_alignment: "center",
      width: 340,
    });
    $("gisBox").hidden = false;
    $("googleBtn").hidden = true;
  } catch (error) {
    say(`${error.message}. नीचे “एक बार सेटअप” में client ID और origin जाँचें`, "error");
    $("clientSetup").hidden = false;
  }
}

async function saveClient() {
  const value = $("clientId").value.trim();
  if (!/^[0-9A-Za-z_-]{10,}\.apps\.googleusercontent\.com$/.test(value)) {
    $("clientState").textContent = "यह client ID जैसा नहीं लग रहा — …apps.googleusercontent.com पर खत्म होता है";
    $("clientState").className = "status error";
    return;
  }
  $("clientSave").disabled = true;
  $("clientState").textContent = "सेव हो रहा है…";
  try {
    const res = await fetch(`${API_BASE}/api/auth/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    clientId = data.clientId;
    $("clientState").textContent = "सेव हो गया — अब ऊपर Google बटन दिखेगा";
    $("clientState").className = "status ok";
    $("clientSetup").hidden = true;
    await renderGoogleButton();
  } catch (error) {
    $("clientState").textContent = error.message;
    $("clientState").className = "status error";
  } finally {
    $("clientSave").disabled = false;
  }
}

async function check() {
  const token = localStorage.getItem(LOGIN_KEY) || "";
  $("originHint").textContent = location.origin;
  try {
    const res = await fetch(`${API_BASE}/api/yt/status`, {
      cache: "no-store",
      credentials: "include",
      headers: token ? { "X-YT-Token": token } : {},
    });
    const data = await res.json();
    clientId = data.loginClientId || "";
    if (data.loggedIn) {
      say(`✓ ${data.account?.email || "इस browser"} से पहले से login हैं — Studio खुल रहा है…`, "ok");
      setTimeout(() => location.replace(back), 800);
    }
    if (data.oauth) {
      // Worker में secret भी है — पुराना redirect वाला रास्ता भी खुला रहता है.
      $("googleBtn").hidden = false;
      $("googleBtn").addEventListener("click", () => {
        location.href = `${API_BASE}/api/auth/google/start?mode=${mode}&return=${encodeURIComponent(back)}`;
      });
    }
    if (clientId) {
      $("clientSetup").hidden = true;
      if (!data.loggedIn) say("Google बटन तैयार है — नीचे दबाइए", "");
      await renderGoogleButton();
    } else {
      $("clientSetup").hidden = false;
      $("clientSetup").open = true;
      if (!data.loggedIn) say("पहले एक बार Google Client ID सेव करें (public id) — फिर यही बटन login/signup करेगा", "");
    }
  } catch {
    say("Worker से कनेक्ट नहीं हुआ — दोबारा कोशिश करें", "error");
    $("clientSetup").hidden = false;
  }
}

$("tabLogin").addEventListener("click", () => {
  mode = "login";
  paint();
});
$("tabSignup").addEventListener("click", () => {
  mode = "signup";
  paint();
});
$("clientSave").addEventListener("click", saveClient);

paint();
check();
