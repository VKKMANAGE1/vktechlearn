/* Footer visitor counter — shared D1 count from the site Worker (/api/visits).
   Har page load par +1. API na mile to localStorage se local count dikhta hai. */
(function () {
  var out = document.getElementById("visit-count");
  if (!out) return;
  var API = "https://site-d28594350583452e987524c38e89b7a9.freebuff.page";
  var KEY = "vk-visits-v1";
  var START = 203234;

  function paint(n) {
    var text = Number(n).toLocaleString("en-US");
    out.replaceChildren();
    Array.prototype.forEach.call(text, function (ch, i) {
      var span = document.createElement("span");
      var digit = ch >= "0" && ch <= "9";
      span.className = digit ? "v-digit" : "v-comma";
      if (digit) span.style.setProperty("--i", i);
      span.textContent = ch;
      out.appendChild(span);
    });
    out.setAttribute("title", "Total visitors: " + text);
  }

  fetch(API + "/api/visits", { method: "POST", cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("offline");
      return res.json();
    })
    .then(function (data) {
      var n = Number(data && data.count);
      if (!isFinite(n) || n <= 0) throw new Error("bad count");
      try { localStorage.setItem(KEY, String(n)); } catch (e) {}
      paint(n);
    })
    .catch(function () {
      var n = START;
      try {
        var saved = Number(localStorage.getItem(KEY) || 0);
        n = (saved >= START ? saved : START - 1) + 1;
        localStorage.setItem(KEY, String(n));
      } catch (e) {}
      paint(n);
    });
})();
