(() => {
  let popupEl = null;

  // Lấy vùng chọn hiện tại (kể cả bên trong Shadow DOM)
  function getActiveSelection() {
    let sel = window.getSelection();
    if (!sel || sel.isCollapsed) return { sel: null, text: "" };
    let text = sel.toString().trim();

    // nếu con trỏ nằm trong shadow root mở, thử selection của shadow root
    if (!text) {
      let node = document.activeElement;
      while (node && node.shadowRoot) {
        const ss = node.shadowRoot.getSelection && node.shadowRoot.getSelection();
        if (ss && !ss.isCollapsed && ss.toString().trim()) {
          sel = ss;
          text = ss.toString().trim();
          break;
        }
        node = node.shadowRoot.activeElement;
      }
    }
    return { sel, text };
  }

  // Nhấn Shift để tra từ đang bôi đen (capture=true để nhận trước khi trang chặn)
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Shift" || e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Không nổ popup tra từ khi người dùng đang nhập văn bản trong input/textarea/contenteditable
      const targetTag = (e.target.tagName || "").toLowerCase();
      if (e.target.isContentEditable || targetTag === "input" || targetTag === "textarea") return;

      // KHI KHÔNG BÔI ĐEN VĂN BẢN (sel.isCollapsed === true HOẶC text rỗng) -> DỪNG NGAY
      const { sel, text } = getActiveSelection();
      if (!text || !sel || sel.isCollapsed) return;

      const wordCount = text.split(/\s+/).length;
      if (wordCount > 4 || text.length > 60) return;

      let rect = null;
      try {
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const r = range.getBoundingClientRect();
          if (r && (r.width || r.height)) rect = r;
        }
      } catch (err) {}

      // Nếu không lấy được vị trí bôi đen thực tế -> không hiện popup
      if (!rect) return;

      if (!isContextValid()) {
        showPopup(text, rect);
        showContextInvalidNotice();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      showPopup(text, rect);
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

  // Extension bị reload/cập nhật trong lúc tab đang mở sẵn -> context cũ "chết",
  // gọi chrome.runtime/chrome.storage sẽ ném "Extension context invalidated".
  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function showContextInvalidNotice() {
    const meaningEl = popupEl?.querySelector(".vs-meaning");
    if (meaningEl) {
      meaningEl.innerHTML = `<span class="vs-error">⚠ Tiện ích vừa được cập nhật. Tải lại trang (F5) để dùng tiếp.</span>`;
    }
    popupEl?.querySelector(".vs-save-box")?.remove();
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
      <div class="vs-meaning-hint" style="display:none;">✏️ Bấm vào nghĩa để sửa nếu dịch chưa đúng</div>
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

    // gọi dịch nghĩa và tra IPA/audio ĐỘC LẬP nhau -> cái nào xong trước hiện trước,
    // không đợi cả 2 (MyMemory và Dictionary/Datamuse nhanh chậm khác nhau).
    try {
      chrome.runtime.sendMessage({ type: "MEANING", word }, (resp) => {
        const meaningEl = popupEl?.querySelector(".vs-meaning");
        const altsEl = popupEl?.querySelector(".vs-alts");
        const hintEl = popupEl?.querySelector(".vs-meaning-hint");
        if (!meaningEl) return;

        if (chrome.runtime.lastError || !(resp && resp.ok)) {
          meaningEl.innerHTML = `<span class="vs-error">Không tra được nghĩa.</span>`;
          return;
        }

        currentMeaning = resp.data.meaning || "(không có bản dịch)";
        meaningEl.textContent = currentMeaning;

        // dịch tự động đôi khi sai -> cho sửa trực tiếp trước khi lưu
        meaningEl.contentEditable = "true";
        meaningEl.addEventListener("input", () => {
          currentMeaning = meaningEl.textContent.trim();
        });
        if (hintEl) hintEl.style.display = "";

        const alts = resp.data.alternatives || [];
        if (alts.length) {
          altsEl.innerHTML =
            "Khác: " +
            alts
              .map((a) => `<span class="vs-alt-choice" data-alt="${escapeHtml(a)}">${escapeHtml(a)}</span>`)
              .join(", ");
          altsEl.querySelectorAll(".vs-alt-choice").forEach((el) => {
            el.addEventListener("click", () => {
              currentMeaning = el.dataset.alt;
              meaningEl.textContent = currentMeaning;
            });
          });
        }
      });
    } catch (e) {
      showContextInvalidNotice();
    }

    try {
      chrome.runtime.sendMessage({ type: "PRONOUNCE", word }, (resp) => {
        const phEl = popupEl?.querySelector(".vs-phonetic");
        if (!phEl) return;
        if (chrome.runtime.lastError || !(resp && resp.ok)) return; // giữ nguyên hint "nhấn loa" mặc định

        const ipa = resp.data.ipa || "";
        currentAudio = resp.data.audio || "";
        phEl.textContent = ipa ? ipa : "🔈 nhấn loa để nghe phát âm";

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
      });
    } catch (e) {
      // im lặng: nghĩa vẫn hiện bình thường dù tra phát âm lỗi
    }

    // ---- Bộ từ ----
    const deckSel = popupEl.querySelector(".vs-deck");
    loadDecks(deckSel);
    // nhớ bộ vừa chọn để lần sau tự chọn lại
    deckSel.addEventListener("change", () => {
      try {
        chrome.storage.local.set({ lastDeck: deckSel.value });
      } catch (e) {
        showContextInvalidNotice();
      }
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
      try {
        chrome.storage.local.get({ decks: ["Mặc định"] }, (res) => {
          const decks = res.decks;
          if (!decks.includes(name)) decks.push(name);
          chrome.storage.local.set({ decks, lastDeck: name }, () => {
            loadDecks(deckSel, name);
            newDeckRow.style.display = "none";
            newDeckInput.value = "";
          });
        });
      } catch (e) {
        showContextInvalidNotice();
      }
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
    try {
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
    } catch (e) {
      showContextInvalidNotice();
    }
  }

  function saveWord(word, meaning, deck, level, ipa, audio, btn) {
    try {
      ensureMigrated(() => {
        chrome.storage.local.get({ words: [] }, (res) => {
          const words = res.words;
          const existing = words.find(
            (w) => w.word.toLowerCase() === word.toLowerCase() && w.deck === deck && !w.deletedAt
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
            id: crypto.randomUUID(),
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
            updatedAt: Date.now(),
            deletedAt: null,
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
      });
    } catch (e) {
      btn.textContent = "⚠ Tải lại trang để lưu";
      setTimeout(() => {
        btn.textContent = "💾 Lưu từ";
      }, 1800);
    }
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
