/* Interactive chapter tests: pick an option per question, submit, see the score. */
(function () {
  var forms = document.querySelectorAll(".quiz-form");

  Array.prototype.forEach.call(forms, function (form) {
    var quiz = form.querySelector(".quiz");
    var questions = Array.prototype.slice.call(quiz.querySelectorAll("li[data-answer]"));
    var total = questions.length;
    var counter = form.querySelector(".quiz-count");
    var result = form.querySelector(".quiz-result");
    var submit = form.querySelector('button[type="submit"]');
    var reset = form.querySelector('button[type="reset"]');

    function answered() {
      return questions.filter(function (li) {
        return li.querySelector("input:checked");
      }).length;
    }

    function updateCounter() {
      if (counter) counter.textContent = answered() + " / " + total + " चुने";
    }

    form.addEventListener("change", updateCounter);
    updateCounter();

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var missing = questions.filter(function (li) {
        return !li.querySelector("input:checked");
      });

      if (missing.length) {
        questions.forEach(function (li) { li.classList.remove("is-missing"); });
        missing[0].classList.add("is-missing");
        result.hidden = false;
        result.className = "quiz-result is-warn";
        result.textContent =
          "पहले सभी " + total + " सवालों के जवाब चुनें — अभी " + missing.length + " बाकी हैं।";
        missing[0].scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      var score = 0;
      questions.forEach(function (li) {
        var correct = Number(li.dataset.answer);
        var picked = Number(li.querySelector("input:checked").value);
        li.classList.remove("is-missing");
        li.classList.add(picked === correct ? "is-correct" : "is-wrong");

        Array.prototype.forEach.call(li.querySelectorAll("input"), function (input) {
          input.disabled = true;
        });

        var explain = li.querySelector(".quiz-explain");
        if (explain) explain.hidden = false;
        if (picked === correct) score += 1;
      });

      var message =
        score >= 16
          ? "बहुत बढ़िया! चैप्टर अच्छी तरह समझ आ गया है।"
          : score >= 12
            ? "ठीक है — गलत सवालों की व्याख्या एक बार देख लें।"
            : "लेसन दोबारा पढ़ें, फिर यह टेस्ट दोबारा दें।";

      result.className = "quiz-result";
      result.innerHTML =
        "<b>आपका स्कोर: " + score + " / " + total + "</b><p>" + message + "</p>";
      result.hidden = false;
      result.focus();
      result.scrollIntoView({ behavior: "smooth", block: "center" });

      submit.disabled = true;
      if (reset) reset.hidden = false;
    });

    form.addEventListener("reset", function () {
      window.setTimeout(function () {
        questions.forEach(function (li) {
          li.classList.remove("is-correct", "is-wrong", "is-missing");
          Array.prototype.forEach.call(li.querySelectorAll("input"), function (input) {
            input.disabled = false;
          });
          var explain = li.querySelector(".quiz-explain");
          if (explain) explain.hidden = true;
        });

        result.hidden = true;
        result.innerHTML = "";
        result.className = "quiz-result";
        submit.disabled = false;
        if (reset) reset.hidden = true;
        updateCounter();
        window.scrollTo({ top: form.offsetTop - 70, behavior: "smooth" });
      }, 0);
    });
  });
})();
