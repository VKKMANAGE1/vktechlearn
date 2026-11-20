/* Login / Sign up page — पहचान Google account से.
 *
 * काम पूरा Worker में होता है:
 *   /api/auth/google/start  → Google की सहमति → /api/yt/oauth/callback
 *   → studio पर login=ok + एक बार का handoff code → /api/auth/session से token.
 * यह page सिर्फ़ Google बटन भेजता है और बता देता है कि पहले से login हैं या नहीं.
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

let mode = "login";

const studioUrl = () => location.href.replace(/login\.html(\?.*)?$/, "");

function paint() {
  $("authTitle").textContent = COPY[mode].title;
  $("authSub").textContent = COPY[mode].sub;
  $("googleLabel").textContent = COPY[mode].label;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabSignup").classList.toggle("active", mode === "signup");
  $("tabLogin").setAttribute("aria-selected", String(mode === "login"));
  $("tabSignup").setAttribute("aria-selected", String(mode === "signup"));
}

function go() {
  const back = encodeURIComponent(studioUrl());
  location.href = `${API_BASE}/api/auth/google/start?mode=${mode}&return=${back}`;
}

async function check() {
  const token = localStorage.getItem(LOGIN_KEY) || "";
  try {
    const res = await fetch(`${API_BASE}/api/yt/status`, {
      cache: "no-store",
      credentials: "include",
      headers: token ? { "X-YT-Token": token } : {},
    });
    const data = await res.json();
    if (data.loggedIn) {
      $("authState").textContent = `✓ ${data.account?.email || "इस browser"} से पहले से login हैं`;
      $("authState").className = "status ok";
    }
    if (!data.googleLogin) {
      $("authNote").innerHTML =
        `अभी Worker में site-level Google client सेट नहीं है — Sites → Secrets में <code>GOOGLE_CLIENT_ID</code> और ` +
        `<code>GOOGLE_CLIENT_SECRET</code> जोड़ें. Google Cloud → Credentials के OAuth client में “Authorized redirect URI” ` +
        `यही रखें: <code>${data.redirectUri || ""}</code>`;
    }
  } catch {
    $("authState").textContent = "Worker से कनेक्ट नहीं हुआ — दोबारा कोशिश करें";
    $("authState").className = "status error";
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
$("googleBtn").addEventListener("click", go);

paint();
check();
