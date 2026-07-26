(() => {
  let lastSelection = "";
  let lastRect = null;
  let popupEl = null;

  // Lấy vùng chọn hiện tại (kể cả bên trong Shadow DOM)
  function getActiveSelection() {
    let sel = window.getSelection();
    let text = sel ? sel.toString().trim() : "";
    // nếu con trỏ nằm trong shadow root mở, thử selection của shadow root
    if (!text) {
      let node = document.activeElement;
      while (node && node.shadowRoot) {
        const ss = node.shadowRoot.getSelection && node.shadowRoot.getSelection();
        if (ss && ss.toString().trim()) {
          sel = ss;
          text = ss.toString().trim();
          break;
        }
        node = node.shadowRoot.activeElement;
      }
    }
    return { sel, text };
  }

  // Ghi lại vùng chọn mỗi khi người dùng bôi đen
  document.addEventListener(
    "selectionchange",
    () => {
      const { sel, text } = getActiveSelection();
      if (text) {
        lastSelection = text;
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect && (rect.width || rect.height)) lastRect = rect;
        } catch (e) {}
      }
    },
    true
  );

  // Nhấn Shift để tra từ đang bôi đen (capture=true để nhận trước khi trang chặn)
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Shift" || e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const text = getActiveSelection().text || lastSelection;
      if (!text) return;

      const wordCount = text.split(/\s+/).length;
      if (wordCount > 4 || text.length > 60) return;

      e.preventDefault();
      e.stopPropagation();
      showPopup(text, lastRect);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (popupEl && !popupEl.contains(e.target)) removePopup();
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") removePopup();
    },
    true
  );

  function removePopup() {
    if (popupEl) {
      popupEl.remove();
      popupEl = null;
    }
  }

  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

  function showPopup(word, rect) {
    removePopup();

    popupEl = document.createElement("div");
    popupEl.className = "vs-popup";
    popupEl.innerHTML = `
      <div class="vs-header">
        <span class="vs-word">${escapeHtml(word)}</span>
        <div class="vs-actions">
          <button class="vs-btn vs-speak" title="Phát âm">🔊</button>
          <button class="vs-btn vs-close" title="Đóng">✕</button>
        </div>
      </div>
      <div class="vs-phonetic">🔈 nhấn loa để nghe phát âm</div>
      <div class="vs-meaning"><span class="vs-loading">Đang tra…</span></div>
      <div class="vs-alts"></div>

      <div class="vs-save-box">
        <div class="vs-row">
          <label class="vs-label">Bộ từ</label>
          <select class="vs-deck"></select>
          <button class="vs-newdeck" title="Tạo bộ mới">＋</button>
        </div>
        <div class="vs-newdeck-row" style="display:none;">
          <input class="vs-newdeck-input" type="text" placeholder="Tên bộ mới…" />
          <button class="vs-newdeck-ok">OK</button>
        </div>
        <div class="vs-row">
          <label class="vs-label">Level</label>
          <div class="vs-levels">
            ${LEVELS.map((l) => `<button class="vs-lv" data-lv="${l}">${l}</button>`).join("")}
          </div>
        </div>
        <button class="vs-save-btn">💾 Lưu từ</button>
      </div>
    `;
    document.body.appendChild(popupEl);
    positionPopup(popupEl, rect);

    let currentMeaning = "";
    let currentAudio = "";

    popupEl.querySelector(".vs-close").addEventListener("click", removePopup);
    popupEl
      .querySelector(".vs-speak")
      .addEventListener("click", () => playPronunciation(word, currentAudio));

    // không tự động đọc; chỉ phát khi bấm nút loa

    // gọi dịch + tra IPA
    chrome.runtime.sendMessage({ type: "TRANSLATE", word }, (resp) => {
      const meaningEl = popupEl?.querySelector(".vs-meaning");
      const altsEl = popupEl?.querySelector(".vs-alts");
      const phEl = popupEl?.querySelector(".vs-phonetic");
      if (!meaningEl) return;

      if (resp && resp.ok) {
        currentMeaning = resp.data.meaning || "(không có bản dịch)";
        meaningEl.textContent = currentMeaning;
        const alts = resp.data.alternatives || [];
        if (alts.length) altsEl.textContent = "Khác: " + alts.join(", ");

        const ipa = resp.data.ipa || "";
        currentAudio = resp.data.audio || "";
        if (phEl) {
          phEl.textContent = ipa ? ipa : "🔈 nhấn loa để nghe phát âm";
        }

        // tự gợi ý level (nếu người dùng chưa tự chọn)
        const sugLv = resp.data.level || "";
        if (sugLv && !selectedLevel) {
          const btn = popupEl?.querySelector(`.vs-lv[data-lv="${sugLv}"]`);
          if (btn) {
            popupEl.querySelectorAll(".vs-lv").forEach((x) => x.classList.remove("active"));
            btn.classList.add("active", "suggested");
            btn.title = "Gợi ý tự động";
            selectedLevel = sugLv;
          }
        }
      } else {
        meaningEl.innerHTML = `<span class="vs-error">Không tra được nghĩa.</span>`;
      }
    });

    // ---- Bộ từ ----
    const deckSel = popupEl.querySelector(".vs-deck");
    loadDecks(deckSel);
    // nhớ bộ vừa chọn để lần sau tự chọn lại
    deckSel.addEventListener("change", () => {
      chrome.storage.local.set({ lastDeck: deckSel.value });
    });

    const newDeckBtn = popupEl.querySelector(".vs-newdeck");
    const newDeckRow = popupEl.querySelector(".vs-newdeck-row");
    const newDeckInput = popupEl.querySelector(".vs-newdeck-input");
    newDeckBtn.addEventListener("click", () => {
      newDeckRow.style.display = newDeckRow.style.display === "none" ? "flex" : "none";
      if (newDeckRow.style.display === "flex") newDeckInput.focus();
    });
    popupEl.querySelector(".vs-newdeck-ok").addEventListener("click", () => {
      const name = newDeckInput.value.trim();
      if (!name) return;
      chrome.storage.local.get({ decks: ["Mặc định"] }, (res) => {
        const decks = res.decks;
        if (!decks.includes(name)) decks.push(name);
        chrome.storage.local.set({ decks, lastDeck: name }, () => {
          loadDecks(deckSel, name);
          newDeckRow.style.display = "none";
          newDeckInput.value = "";
        });
      });
    });

    // ---- Level ----
    let selectedLevel = "";
    popupEl.querySelectorAll(".vs-lv").forEach((b) => {
      b.addEventListener("click", () => {
        popupEl.querySelectorAll(".vs-lv").forEach((x) => x.classList.remove("active", "suggested"));
        b.classList.add("active");
        selectedLevel = b.dataset.lv;
      });
    });

    // ---- Lưu ----
    const saveBtn = popupEl.querySelector(".vs-save-btn");
    saveBtn.addEventListener("click", () => {
      const deck = deckSel.value || "Mặc định";
      const ipaText = popupEl.querySelector(".vs-phonetic")?.textContent || "";
      const ipa = ipaText.includes("nhấn loa") ? "" : ipaText;
      saveWord(word, currentMeaning, deck, selectedLevel, ipa, currentAudio, saveBtn);
    });
  }

  function loadDecks(selectEl, selectName) {
    chrome.storage.local.get({ decks: ["Mặc định"], lastDeck: "" }, (res) => {
      const decks = res.decks.length ? res.decks : ["Mặc định"];
      selectEl.innerHTML = decks
        .map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)
        .join("");
      // ưu tiên: bộ vừa được chỉ định > bộ dùng lần cuối > bộ cuối danh sách
      let target = selectName || res.lastDeck || decks[decks.length - 1];
      if (!decks.includes(target)) target = decks[decks.length - 1];
      selectEl.value = target;
    });
  }

  function saveWord(word, meaning, deck, level, ipa, audio, btn) {
    chrome.storage.local.get({ words: [] }, (res) => {
      const words = res.words;
      const existing = words.find(
        (w) => w.word.toLowerCase() === word.toLowerCase() && w.deck === deck
      );

      // đã có trong đúng bộ này -> không lưu lại
      if (existing) {
        btn.textContent = "⚠ Từ đã có trong bộ này";
        btn.classList.add("exists");
        setTimeout(() => {
          btn.textContent = "💾 Lưu từ";
          btn.classList.remove("exists");
        }, 1400);
        return;
      }

      words.unshift({
        word,
        meaning: meaning || "",
        deck: deck || "Mặc định",
        level: level || "",
        ipa: ipa || "",
        audio: audio || "",
        date: new Date().toISOString(),
        source: location.hostname,
        // dữ liệu ôn tập (spaced repetition)
        box: 1,          // hộp Leitner 1..5
        due: Date.now(), // thời điểm nên ôn lại
        correct: 0,
        wrong: 0,
      });

      chrome.storage.local.set({ words, lastDeck: deck }, () => {
        btn.textContent = "✓ Đã lưu";
        btn.classList.add("saved");
        setTimeout(() => {
          btn.textContent = "💾 Lưu từ";
          btn.classList.remove("saved");
        }, 1200);
      });
    });
  }

  function playPronunciation(text, audioUrl) {
    if (audioUrl) {
      try {
        const a = new Audio(audioUrl);
        a.play().catch(() => speak(text)); // lỗi phát thì fallback
        return;
      } catch (e) {}
    }
    speak(text);
  }

  function speak(text) {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function positionPopup(el, rect) {
    const margin = 8;
    let top, left;
    if (rect) {
      top = window.scrollY + rect.bottom + margin;
      left = window.scrollX + rect.left;
    } else {
      top = window.scrollY + 100;
      left = window.scrollX + 100;
    }
    const w = 300;
    if (left + w > window.scrollX + window.innerWidth) {
      left = window.scrollX + window.innerWidth - w - margin;
    }
    el.style.top = top + "px";
    el.style.left = Math.max(margin, left) + "px";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
})();
