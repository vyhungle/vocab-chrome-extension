const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const filterDeck = document.getElementById("filterDeck");
const filterLevel = document.getElementById("filterLevel");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");
const deckPanel = document.getElementById("deckPanel");

const DAY = 24 * 60 * 60 * 1000;

function loadDeckFilter() {
  chrome.storage.local.get({ decks: ["Mặc định"], words: [] }, (res) => {
    const now = Date.now();
    const decks = new Set(res.decks);
    res.words.forEach((w) => w.deck && decks.add(w.deck));

    // đếm số từ + số đến hạn cho mỗi bộ
    const count = {};
    const due = {};
    res.words.forEach((w) => {
      const d = w.deck || "Mặc định";
      count[d] = (count[d] || 0) + 1;
      if ((w.due ?? 0) <= now) due[d] = (due[d] || 0) + 1;
    });

    const cur = filterDeck.value;
    filterDeck.innerHTML =
      `<option value="">Tất cả bộ (${res.words.length})</option>` +
      [...decks]
        .map((d) => {
          const c = count[d] || 0;
          const dueTxt = due[d] ? ` · ${due[d]} đến hạn` : "";
          return `<option value="${esc(d)}">${esc(d)} — ${c} từ${dueTxt}</option>`;
        })
        .join("");
    filterDeck.value = cur;
  });
}

function render() {
  chrome.storage.local.get({ words: [] }, (res) => {
    let words = res.words;
    const fd = filterDeck.value;
    const fl = filterLevel.value;
    const q = (searchEl.value || "").trim().toLowerCase();
    if (fd) words = words.filter((w) => (w.deck || "Mặc định") === fd);
    if (fl) words = words.filter((w) => w.level === fl);
    if (q)
      words = words.filter(
        (w) =>
          (w.word || "").toLowerCase().includes(q) ||
          (w.meaning || "").toLowerCase().includes(q)
      );

    words = sortWords(words, sortEl.value);

    countEl.textContent = words.length;

    if (!words.length) {
      listEl.innerHTML = `<div class="empty">Chưa có từ nào ở đây.<br>Bôi đen một từ trên web rồi nhấn <b>Shift</b> để lưu.</div>`;
      return;
    }

    listEl.innerHTML = "";
    words.forEach((w) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div>
          <div class="w">${esc(w.word)}${w.ipa ? ` <span class="ipa">${esc(w.ipa)}</span>` : ""}</div>
          <div class="m">${esc(w.meaning || "")}</div>
          <div class="tags">
            <span class="tag">${esc(w.deck || "Mặc định")}</span>
            ${w.level ? `<span class="tag lv">${esc(w.level)}</span>` : ""}
            <span class="mastery" title="Mức thuộc ${w.box || 1}/5">${masteryDots(w.box || 1)}</span>
          </div>
          <div class="meta">
            <span class="ok">✓${w.correct || 0}</span>
            <span class="no">✗${w.wrong || 0}</span>
            <span>${dueLabel(w.due)}</span>
            <span>thêm ${fmtDate(w.date)}</span>
          </div>
          <div class="src">${esc(w.source || "")}</div>
        </div>
        <div class="item-actions">
          <button class="ibtn speak" title="Phát âm">🔊</button>
          <button class="ibtn move" title="Chuyển bộ">📁</button>
          <button class="ibtn del" title="Xóa">🗑</button>
        </div>
      `;
      div.querySelector(".speak").addEventListener("click", () => playPron(w.word, w.audio));
      div.querySelector(".move").addEventListener("click", () => moveWord(w));
      div.querySelector(".del").addEventListener("click", () => removeWord(w));
      listEl.appendChild(div);
    });
  });
}

// ---------- Sắp xếp ----------
function sortWords(words, mode) {
  const a = words.slice();
  if (mode === "az") {
    a.sort((x, y) => (x.word || "").localeCompare(y.word || ""));
  } else if (mode === "due") {
    a.sort((x, y) => (x.due ?? 0) - (y.due ?? 0));
  } else if (mode === "weak") {
    // yếu = box thấp; hòa thì nhiều lần sai hơn lên trước
    a.sort((x, y) => (x.box || 1) - (y.box || 1) || (y.wrong || 0) - (x.wrong || 0));
  } else {
    // mới thêm
    a.sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
  }
  return a;
}

// ---------- Hiển thị dữ liệu quản lý ----------
function masteryDots(box) {
  const n = Math.max(1, Math.min(5, box));
  return "●".repeat(n) + `<span class="off">${"●".repeat(5 - n)}</span>`;
}

function dueLabel(due) {
  if (due == null) return "";
  const diff = due - Date.now();
  if (diff <= 0) return `<span class="due-now">● đến hạn</span>`;
  const days = Math.ceil(diff / DAY);
  return days <= 1 ? "ôn: mai" : `ôn: còn ${days}d`;
}

function fmtDate(iso) {
  if (!iso) return "?";
  const d = new Date(iso);
  if (isNaN(d)) return "?";
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ---------- Chuyển từ sang bộ khác ----------
function moveWord(target) {
  chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
    const decks = res.decks;
    const dest = prompt(
      `Chuyển "${target.word}" sang bộ nào?\n\nCác bộ hiện có: ${decks.join(", ")}\n(Gõ tên mới để tạo bộ mới)`,
      target.deck || "Mặc định"
    );
    if (dest == null) return;
    const name = dest.trim();
    if (!name || name === target.deck) return;

    const words = res.words.map((w) => {
      if (w.word === target.word && w.deck === target.deck && w.date === target.date) {
        return { ...w, deck: name };
      }
      return w;
    });
    const newDecks = decks.includes(name) ? decks : [...decks, name];
    chrome.storage.local.set({ words, decks: newDecks }, () => {
      loadDeckFilter();
      render();
    });
  });
}

function removeWord(target) {
  chrome.storage.local.get({ words: [] }, (res) => {
    const words = res.words.filter(
      (w) => !(w.word === target.word && w.deck === target.deck && w.date === target.date)
    );
    chrome.storage.local.set({ words }, render);
  });
}

// ---------- Quản lý bộ từ ----------
document.getElementById("manageDecks").addEventListener("click", () => {
  if (!deckPanel.classList.contains("hidden")) {
    deckPanel.classList.add("hidden");
    return;
  }
  renderDeckPanel();
  deckPanel.classList.remove("hidden");
});

function renderDeckPanel() {
  chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
    const decks = new Set(res.decks);
    res.words.forEach((w) => w.deck && decks.add(w.deck));
    const count = {};
    res.words.forEach((w) => {
      const d = w.deck || "Mặc định";
      count[d] = (count[d] || 0) + 1;
    });

    deckPanel.innerHTML = `<h3>Quản lý bộ từ</h3>`;
    [...decks].forEach((d) => {
      const row = document.createElement("div");
      row.className = "deck-row";
      row.innerHTML = `
        <span class="dn">${esc(d)}</span>
        <span class="dc">${count[d] || 0} từ</span>
        <button class="rn">✏ Đổi tên</button>
        <button class="dl danger">🗑</button>
      `;
      row.querySelector(".rn").addEventListener("click", () => renameDeck(d));
      row.querySelector(".dl").addEventListener("click", () => deleteDeck(d));
      deckPanel.appendChild(row);
    });
  });
}

function renameDeck(oldName) {
  const dest = prompt(
    `Đổi tên bộ "${oldName}" thành:\n(Trùng tên bộ khác = gộp vào bộ đó)`,
    oldName
  );
  if (dest == null) return;
  const name = dest.trim();
  if (!name || name === oldName) return;

  chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
    const words = res.words.map((w) =>
      (w.deck || "Mặc định") === oldName ? { ...w, deck: name } : w
    );
    let decks = res.decks.map((d) => (d === oldName ? name : d));
    decks = [...new Set(decks)]; // gộp nếu trùng
    chrome.storage.local.set({ words, decks }, () => {
      loadDeckFilter();
      renderDeckPanel();
      render();
    });
  });
}

function deleteDeck(name) {
  chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
    const n = res.words.filter((w) => (w.deck || "Mặc định") === name).length;
    if (
      !confirm(
        n
          ? `Xóa bộ "${name}"? ${n} từ trong bộ sẽ được chuyển về "Mặc định".`
          : `Xóa bộ "${name}"?`
      )
    )
      return;

    const words = res.words.map((w) =>
      (w.deck || "Mặc định") === name ? { ...w, deck: "Mặc định" } : w
    );
    let decks = res.decks.filter((d) => d !== name);
    if (!decks.length) decks = ["Mặc định"];
    if (!decks.includes("Mặc định")) decks.unshift("Mặc định");
    chrome.storage.local.set({ words, decks }, () => {
      loadDeckFilter();
      renderDeckPanel();
      render();
    });
  });
}

// ---------- Âm thanh ----------
function speak(text) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

function playPron(text, audioUrl) {
  if (audioUrl) {
    try {
      const a = new Audio(audioUrl);
      a.play().catch(() => speak(text));
      return;
    } catch (e) {}
  }
  speak(text);
}

// ---------- Bộ lọc / tìm kiếm ----------
filterDeck.addEventListener("change", render);
filterLevel.addEventListener("change", render);
searchEl.addEventListener("input", render);
sortEl.addEventListener("change", render);

document.getElementById("review").addEventListener("click", () => {
  const params = new URLSearchParams();
  if (filterDeck.value) params.set("deck", filterDeck.value);
  if (filterLevel.value) params.set("level", filterLevel.value);
  const url = chrome.runtime.getURL("review.html") + "?" + params.toString();
  chrome.tabs.create({ url });
});

document.getElementById("clear").addEventListener("click", () => {
  if (confirm("Xóa toàn bộ từ đã lưu?")) {
    chrome.storage.local.set({ words: [] }, render);
  }
});

// ---------- Xuất CSV (theo bộ lọc) ----------
document.getElementById("export").addEventListener("click", () => {
  chrome.storage.local.get({ words: [] }, (res) => {
    let words = res.words;
    const fd = filterDeck.value;
    const fl = filterLevel.value;
    if (fd) words = words.filter((w) => (w.deck || "Mặc định") === fd);
    if (fl) words = words.filter((w) => w.level === fl);

    const rows = [["word", "ipa", "meaning", "deck", "level", "source", "date"]];
    words.forEach((w) =>
      rows.push([w.word, w.ipa || "", w.meaning || "", w.deck || "", w.level || "", w.source || "", w.date || ""])
    );
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const slug = (fd || "all").replace(/[^\w\-]+/g, "_");
    const a = document.createElement("a");
    a.href = url; a.download = `vocab-${slug}.csv`; a.click();
    URL.revokeObjectURL(url);
  });
});

// ---------- Copy Quizlet ----------
document.getElementById("copyQuizlet").addEventListener("click", (e) => {
  chrome.storage.local.get({ words: [] }, (res) => {
    let words = res.words;
    const fd = filterDeck.value;
    const fl = filterLevel.value;
    if (fd) words = words.filter((w) => (w.deck || "Mặc định") === fd);
    if (fl) words = words.filter((w) => w.level === fl);

    if (!words.length) {
      flashBtn(e.target, "Không có từ");
      return;
    }

    const text = words
      .map((w) => `${w.word}\t${(w.meaning || "").replace(/\s+/g, " ").trim()}`)
      .join("\n");

    navigator.clipboard.writeText(text).then(
      () => flashBtn(e.target, `✓ Đã copy ${words.length} từ`),
      () => flashBtn(e.target, "Copy lỗi")
    );
  });
});

// ---------- Backup: xuất toàn bộ dữ liệu ra JSON ----------
document.getElementById("backup").addEventListener("click", () => {
  chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
    const data = {
      app: "VocabShift",
      version: 1,
      exportedAt: new Date().toISOString(),
      decks: res.decks,
      words: res.words,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

// ---------- Import: nạp dữ liệu từ file JSON (gộp, bỏ qua trùng) ----------
const importFile = document.getElementById("importFile");
document.getElementById("import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data.words;
      if (!Array.isArray(incoming)) throw new Error("format");
      const incomingDecks = Array.isArray(data.decks) ? data.decks : [];

      chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
        const words = res.words.slice();
        const key = (w) => `${(w.word || "").toLowerCase()}||${w.deck || "Mặc định"}`;
        const seen = new Set(words.map(key));
        let added = 0;
        incoming.forEach((w) => {
          if (!w || !w.word || seen.has(key(w))) return;
          seen.add(key(w));
          words.unshift({
            word: w.word,
            meaning: w.meaning || "",
            deck: w.deck || "Mặc định",
            level: w.level || "",
            ipa: w.ipa || "",
            audio: w.audio || "",
            date: w.date || new Date().toISOString(),
            source: w.source || "",
            box: w.box || 1,
            due: w.due || Date.now(),
            correct: w.correct || 0,
            wrong: w.wrong || 0,
          });
          added++;
        });

        const decks = res.decks.slice();
        [...incomingDecks, ...incoming.map((w) => w && w.deck).filter(Boolean)].forEach((d) => {
          if (d && !decks.includes(d)) decks.push(d);
        });

        chrome.storage.local.set({ words, decks }, () => {
          loadDeckFilter();
          render();
          alert(`Đã nhập ${added} từ mới (bỏ qua trùng). Tổng: ${words.length} từ.`);
        });
      });
    } catch (e) {
      alert("File không hợp lệ. Cần file backup .json xuất từ VocabShift.");
    }
    importFile.value = "";
  };
  reader.readAsText(file);
});

function flashBtn(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => (btn.textContent = old), 1400);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

loadDeckFilter();
render();
