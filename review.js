// ---------- Tham số ----------
const params = new URLSearchParams(location.search);
const DAY = 24 * 60 * 60 * 1000;
// khoảng cách ôn lại theo hộp Leitner (box 1..5)
const BOX_INTERVAL = [0, 0, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY];

let allWords = []; // đã lọc bỏ từ xoá mềm (deletedAt) -> dùng để hiển thị/pool/quiz
let allWordsFull = []; // đầy đủ, kể cả đã xoá mềm -> nguồn duy nhất để tìm/ghi lại storage
let allDecks = [];
let queue = [];
let current = 0;
let stats = { correct: 0, wrong: 0 };
let selMode = "flashcard";
let selSchedule = "srs";
let selDeck = "";
let locked = false; // chặn chấm điểm 2 lần khi đang chờ setTimeout hoặc bấm phím dồn dập
let streak = { last: "", count: 0 };
let batchSize = "20"; // số từ mỗi vòng: "10"/"20"/"50"/"all"
let sessionDoneIds = new Set(); // các từ đã ôn trong chuỗi vòng hiện tại (tránh lặp khi "Ôn tất cả")
let session = null; // phiên dang dở đọc từ storage (để hiện banner resume)
let sessionStartedAt = 0;

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);

// ---------- Khởi tạo ----------
ensureMigrated(() => {
  chrome.storage.local.get(
    { words: [], decks: ["Mặc định"], streak: { last: "", count: 0 }, batchSize: "20", session: null },
    (res) => {
      allWordsFull = res.words;
      allWords = allWordsFull.filter((w) => !w.deletedAt);
      streak = res.streak || { last: "", count: 0 };
      batchSize = String(res.batchSize || "20");
      $("batchSize").value = batchSize;
      session = res.session || null;

      const decks = new Set(res.decks);
      allWords.forEach((w) => w.deck && decks.add(w.deck));
      allDecks = [...decks];

      // áp bộ lọc từ URL (mở từ popup)
      if (params.get("deck")) selDeck = params.get("deck");
      if (params.get("level")) $("level").value = params.get("level");

      renderDeckGrid();
      renderDash();
      renderStreakInto("streak");
      renderResumeBanner();
      updatePoolInfo();
      updateScheduleHint();
    }
  );
});

// ---------- Streak (chuỗi ngày ôn liên tiếp) ----------
function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderStreakInto(elId) {
  const el = $(elId);
  if (!el) return;
  const today = dateStr(new Date());
  const yesterday = dateStr(new Date(Date.now() - DAY));
  let displayCount = streak.count || 0;
  // chuỗi đã đứt (bỏ ôn hơn 1 ngày) -> chỉ hiển thị 0, không ghi đè storage
  if (streak.last !== today && streak.last !== yesterday) displayCount = 0;

  if (displayCount > 0) {
    el.classList.remove("hidden");
    el.innerHTML = `<span class="flame">🔥</span><div><b>${displayCount} ngày</b><span> liên tiếp ôn từ</span></div>`;
  } else {
    el.classList.add("hidden");
  }
}

// chỉ gọi khi hoàn thành 1 buổi ôn thật sự (finish())
function updateStreak() {
  const today = dateStr(new Date());
  const yesterday = dateStr(new Date(Date.now() - DAY));
  if (streak.last === today) {
    // đã tính hôm nay rồi
  } else if (streak.last === yesterday) {
    streak = { last: today, count: (streak.count || 0) + 1 };
  } else {
    streak = { last: today, count: 1 };
  }
  chrome.storage.local.set({ streak });
}

// ---------- Định danh 1 từ (dùng id ổn định) ----------
function idKey(w) {
  return w.id;
}
function findWordById(id) {
  return allWords.find((w) => w.id === id);
}

// ---------- Resume buổi ôn dang dở ----------
function renderResumeBanner() {
  const banner = $("resumeBanner");
  if (!session || !Array.isArray(session.ids) || !session.ids.length) {
    banner.classList.add("hidden");
    return;
  }
  const tooOld = !session.startedAt || Date.now() - session.startedAt > DAY;
  const remainingIds = session.ids.slice(session.current || 0);
  const validCount = remainingIds.filter((id) => findWordById(id)).length;

  if (tooOld || validCount < 1) {
    clearSession();
    banner.classList.add("hidden");
    return;
  }

  $("rbCount").textContent = validCount;
  banner.classList.remove("hidden");
}

function clearSession() {
  session = null;
  chrome.storage.local.remove("session");
}

function saveSessionState() {
  session = {
    ids: queue.map(idKey),
    current,
    stats,
    selMode,
    selSchedule,
    selDeck,
    selLevel: $("level").value,
    batchSize,
    startedAt: sessionStartedAt,
  };
  return session;
}

function syncButtonGroup(groupId, value) {
  [...$(groupId).children].forEach((b) => b.classList.toggle("active", b.dataset.v === value));
}

// ---------- Sidebar điều hướng ----------
function setActiveNav(pageId) {
  $("navSetup").classList.toggle("active", pageId === "setup");
  $("navBrowse").classList.toggle("active", pageId === "browse");
}

// khoá sidebar khi đang trong buổi ôn -> tránh bấm nhầm sang trang khác làm mất tiến độ
function lockSidebar() {
  $("sidebar").classList.add("locked");
  $("sidebarLockMsg").classList.remove("hidden");
}
function unlockSidebar() {
  $("sidebar").classList.remove("locked");
  $("sidebarLockMsg").classList.add("hidden");
}

$("navSetup").addEventListener("click", () => {
  $("browse").classList.add("hidden");
  $("done").classList.add("hidden");
  $("setup").classList.remove("hidden");
  setActiveNav("setup");
});
$("navBrowse").addEventListener("click", () => {
  populateBrowseFilters();
  renderBrowseList();
  $("setup").classList.add("hidden");
  $("done").classList.add("hidden");
  $("browse").classList.remove("hidden");
  setActiveNav("browse");
});

function resumeSession() {
  if (!session) return;
  const remainingIds = session.ids.slice(session.current || 0);
  const restoredQueue = remainingIds.map(findWordById).filter(Boolean);

  if (!restoredQueue.length) {
    clearSession();
    $("resumeBanner").classList.add("hidden");
    return;
  }

  selMode = session.selMode || "flashcard";
  selSchedule = session.selSchedule || "srs";
  selDeck = session.selDeck || "";
  $("level").value = session.selLevel || "";
  batchSize = session.batchSize || "20";
  $("batchSize").value = batchSize;
  sessionStartedAt = session.startedAt || Date.now();

  syncButtonGroup("mode", selMode);
  syncButtonGroup("schedule", selSchedule);
  renderDeckGrid();

  sessionDoneIds = new Set(session.ids.slice(0, session.current || 0));

  queue = restoredQueue;
  current = 0;
  stats = session.stats || { correct: 0, wrong: 0 };

  $("resumeBanner").classList.add("hidden");
  $("setup").classList.add("hidden");
  $("done").classList.add("hidden");
  $("session").classList.remove("hidden");
  $("total").textContent = queue.length;
  lockSidebar();
  showCard();
}

$("resumeBtn").addEventListener("click", resumeSession);
$("dismissResumeBtn").addEventListener("click", () => {
  clearSession();
  $("resumeBanner").classList.add("hidden");
});

// ---------- Modal cấu hình ôn tập ----------
function openConfigModal(deckName) {
  if (deckName !== undefined) selDeck = deckName;
  const titleEl = $("modalDeckTitle");
  const subEl = $("modalDeckSub");

  if (selDeck) {
    titleEl.textContent = `⚙️ Cấu hình: ${selDeck}`;
    subEl.textContent = `Tùy chỉnh chế độ học cho bộ từ "${selDeck}"`;
  } else {
    titleEl.textContent = `⚙️ Cấu hình: Tất cả bộ từ`;
    subEl.textContent = `Tùy chỉnh chế độ học cho toàn bộ từ vựng`;
  }

  updatePoolInfo();
  const modal = $("configModal");
  if (modal) modal.classList.remove("hidden");
}

function closeConfigModal() {
  const modal = $("configModal");
  if (modal) modal.classList.add("hidden");
}

if ($("quickStartBtn")) {
  $("quickStartBtn").addEventListener("click", () => openConfigModal(selDeck));
}
if ($("closeConfigModal")) {
  $("closeConfigModal").addEventListener("click", closeConfigModal);
}
if ($("configModal")) {
  $("configModal").addEventListener("click", (e) => {
    if (e.target === $("configModal")) closeConfigModal();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("configModal") && !$("configModal").classList.contains("hidden")) {
    closeConfigModal();
  }
});

// ---------- Lưới bộ từ ----------
function renderDeckGrid() {
  const now = Date.now();
  const count = {}, due = {};
  allWords.forEach((w) => {
    const d = w.deck || "Mặc định";
    count[d] = (count[d] || 0) + 1;
    if ((w.due ?? 0) <= now) due[d] = (due[d] || 0) + 1;
  });
  const totalDue = allWords.filter((w) => (w.due ?? 0) <= now).length;

  const cards = [
    { name: "", label: "Tất cả bộ từ", c: allWords.length, d: totalDue },
    ...allDecks.map((d) => ({ name: d, label: d, c: count[d] || 0, d: due[d] || 0 })),
  ];

  const filterEl = $("deckFilter");
  const showFilter = allDecks.length > 12;
  filterEl.classList.toggle("hidden", !showFilter);
  const q = showFilter ? (filterEl.value || "").trim().toLowerCase() : "";

  const grid = $("deckGrid");
  grid.innerHTML = cards
    .filter((c) => !q || c.label.toLowerCase().includes(q))
    .map((c) => {
      const active = c.name === selDeck ? " active" : "";
      const dueBadge = c.d ? `<span class="due-badge">🔥 ${c.d} đến hạn</span>` : "";
      const icon = c.name === "" ? "📚" : "📁";
      return `<button type="button" class="deck-card${active}" data-deck="${esc(c.name)}">
        <div class="deck-card-top">
          <span class="dn">${icon} ${esc(c.label)}</span>
        </div>
        <div class="deck-card-bottom">
          <span class="dc">${c.c} từ vựng</span>
          ${dueBadge}
        </div>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".deck-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      selDeck = btn.dataset.deck;
      grid.querySelectorAll(".deck-card").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      openConfigModal(selDeck);
    });
  });
}
$("deckFilter").addEventListener("input", renderDeckGrid);

// ---------- Bảng tổng quan ----------
function renderDash() {
  const now = Date.now();
  const total = allWords.length;
  const dueN = allWords.filter((w) => (w.due ?? 0) <= now).length;
  const mastered = allWords.filter((w) => (w.box || 1) >= 4).length;
  const learning = total - mastered;
  let c = 0, wr = 0;
  allWords.forEach((w) => { c += w.correct || 0; wr += w.wrong || 0; });
  const acc = c + wr ? Math.round((c / (c + wr)) * 100) : 0;

  $("dash").innerHTML = `
    <div class="stat stat-total">
      <div class="stat-icon">📚</div>
      <div class="stat-info"><b>${total}</b><small>Tổng số từ</small></div>
    </div>
    <div class="stat stat-due">
      <div class="stat-icon">🔥</div>
      <div class="stat-info"><b>${dueN}</b><small>Từ đến hạn</small></div>
    </div>
    <div class="stat stat-mastered">
      <div class="stat-icon">🎉</div>
      <div class="stat-info"><b>${mastered}</b><small>Đã thuộc</small></div>
    </div>
    <div class="stat stat-acc">
      <div class="stat-icon">🎯</div>
      <div class="stat-info"><b>${acc}%</b><small>Đúng (${learning} đang học)</small></div>
    </div>
  `;
}

// ---------- Chọn kiểu / chế độ ----------
$("mode").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  [...$("mode").children].forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  selMode = e.target.dataset.v;
});
$("schedule").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  [...$("schedule").children].forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  selSchedule = e.target.dataset.v;
  updatePoolInfo();
  updateScheduleHint();
});
$("level").addEventListener("change", updatePoolInfo);
$("batchSize").addEventListener("change", () => {
  batchSize = $("batchSize").value;
  chrome.storage.local.set({ batchSize });
  updatePoolInfo();
});

function getPool() {
  const d = selDeck;
  const l = $("level").value;
  let pool = allWords.slice();
  if (d) pool = pool.filter((w) => (w.deck || "Mặc định") === d);
  if (l) pool = pool.filter((w) => w.level === l);
  if (selSchedule === "srs") {
    const now = Date.now();
    pool = pool.filter((w) => (w.due ?? 0) <= now);
  }
  return pool;
}

function updatePoolInfo() {
  const n = getPool().length;
  const batchN = batchSize === "all" ? n : Math.min(n, Number(batchSize));
  const roundTxt = batchN < n ? ` — vòng này ôn ${batchN} từ` : "";

  if (selSchedule === "srs") {
    $("poolInfo").textContent = n
      ? `${n} từ đến hạn ôn${roundTxt}.`
      : "Không có từ nào đến hạn. Chọn “Ôn tất cả” để ôn ngay.";
  } else {
    $("poolInfo").textContent = n ? `${n} từ sẽ được ôn${roundTxt}.` : "Không có từ nào phù hợp.";
  }
}

function updateScheduleHint() {
  $("scheduleHint").textContent =
    selSchedule === "srs"
      ? "Chỉ ôn những từ đến hạn; từ sai sẽ hiện lại sớm hơn."
      : "Ôn toàn bộ từ trong bộ/level đã chọn.";
}

// ---------- Bắt đầu 1 vòng ôn (dùng chung cho "Bắt đầu ôn" và "Vòng tiếp theo") ----------
function beginQueue(pool) {
  const n = batchSize === "all" ? pool.length : Number(batchSize);
  queue = shuffle(pool).slice(0, n);
  if (!queue.length) {
    alert("Không có từ nào để ôn với lựa chọn hiện tại.");
    return false;
  }
  closeConfigModal();
  current = 0;
  stats = { correct: 0, wrong: 0 };
  sessionStartedAt = Date.now();
  $("setup").classList.add("hidden");
  $("done").classList.add("hidden");
  $("session").classList.remove("hidden");
  $("total").textContent = queue.length;
  chrome.storage.local.set({ session: saveSessionState() });
  lockSidebar();
  showCard();
  return true;
}

$("start").addEventListener("click", () => {
  sessionDoneIds = new Set();
  beginQueue(getPool());
});

$("nextRound").addEventListener("click", () => {
  const pool = getPool().filter((w) => !sessionDoneIds.has(idKey(w)));
  beginQueue(pool); // giữ nguyên sessionDoneIds để không lặp từ đã ôn trong chuỗi vòng này
});

$("again").addEventListener("click", () => {
  $("done").classList.add("hidden");
  $("setup").classList.remove("hidden");
  setActiveNav("setup");
  // nạp lại dữ liệu mới nhất
  chrome.storage.local.get({ words: [] }, (res) => {
    allWordsFull = res.words;
    allWords = allWordsFull.filter((w) => !w.deletedAt);
    renderDeckGrid();
    renderDash();
    renderStreakInto("streak");
    updatePoolInfo();
  });
});

$("backToList").addEventListener("click", () => {
  location.href = chrome.runtime.getURL("popup.html");
});

// ---------- Xem từ đã học ----------
$("openBrowse").addEventListener("click", () => {
  populateBrowseFilters();
  renderBrowseList();
  $("setup").classList.add("hidden");
  $("browse").classList.remove("hidden");
  setActiveNav("browse");
});

if ($("browseBack")) {
  $("browseBack").addEventListener("click", () => {
    $("browse").classList.add("hidden");
    $("setup").classList.remove("hidden");
    setActiveNav("setup");
  });
}

function populateBrowseFilters() {
  const cur = $("browseDeck").value;
  $("browseDeck").innerHTML =
    `<option value="">Tất cả bộ (${allWords.length})</option>` +
    allDecks.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
  $("browseDeck").value = cur;
}

function getBrowsePool() {
  const q = ($("browseSearch").value || "").trim().toLowerCase();
  const deck = $("browseDeck").value;
  const level = $("browseLevel").value;
  const mastery = $("browseMastery").value;

  let pool = allWords.slice();
  if (deck) pool = pool.filter((w) => (w.deck || "Mặc định") === deck);
  if (level) pool = pool.filter((w) => w.level === level);
  if (mastery === "mastered") pool = pool.filter((w) => (w.box || 1) >= 4);
  else if (mastery === "learning") pool = pool.filter((w) => (w.box || 1) < 4);
  if (q) {
    pool = pool.filter(
      (w) => (w.word || "").toLowerCase().includes(q) || (w.meaning || "").toLowerCase().includes(q)
    );
  }
  pool.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)); // mới thêm trước
  return pool;
}

function renderBrowseList() {
  const pool = getBrowsePool();
  const listEl = $("browseList");

  if (!pool.length) {
    listEl.innerHTML = `<div class="browse-empty">Không có từ nào phù hợp.</div>`;
    return;
  }

  listEl.innerHTML = pool
    .map((w) => {
      const masteryLevel = Math.max(1, Math.min(5, w.box || 1));
      const dots = "●".repeat(masteryLevel) + `<span class="off">${"●".repeat(5 - masteryLevel)}</span>`;
      return `
        <div class="browse-item" data-id="${esc(w.id)}">
          <div>
            <div class="bw">${esc(w.word)}${w.ipa ? `<span class="ipa">${esc(w.ipa)}</span>` : ""}</div>
            <div class="bm">${esc(w.meaning || "(chưa có nghĩa)")}</div>
            <div class="btags">
              <span class="btag">${esc(w.deck || "Mặc định")}</span>
              ${w.level ? `<span class="btag lv">${esc(w.level)}</span>` : ""}
              <span class="bmastery" title="Mức thuộc ${masteryLevel}/5">${dots}</span>
            </div>
          </div>
          <button class="bspeak" title="Phát âm">🔊</button>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".browse-item").forEach((el) => {
    const w = pool.find((x) => x.id === el.dataset.id);
    el.querySelector(".bspeak").addEventListener("click", () => playPron(w.word, w.audio));
  });
}

$("browseSearch").addEventListener("input", renderBrowseList);
$("browseDeck").addEventListener("change", renderBrowseList);
$("browseLevel").addEventListener("change", renderBrowseList);
$("browseMastery").addEventListener("change", renderBrowseList);

// ---------- Phím tắt ----------
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return; // để ô "Gõ lại từ" tự xử lý phím riêng
  if ($("session").classList.contains("hidden")) return; // chỉ áp dụng khi đang trong buổi ôn

  if (selMode === "flashcard" && !$("flashcard").classList.contains("hidden")) {
    handleFlashcardKey(e);
  } else if (selMode === "quiz" && !$("quiz").classList.contains("hidden")) {
    handleQuizKey(e);
  }
});

function handleFlashcardKey(e) {
  if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
    e.preventDefault();
    $("flip").click();
    return;
  }
  const gradeVisible = !$("fcGrade").classList.contains("hidden");
  if (!gradeVisible) return;
  if (e.key === "ArrowLeft" || e.key === "1") {
    e.preventDefault();
    $("fcGrade").querySelector(".wrong").click();
  } else if (e.key === "ArrowRight" || e.key === "2") {
    e.preventDefault();
    $("fcGrade").querySelector(".right").click();
  }
}

function handleQuizKey(e) {
  const idx = Number(e.key) - 1;
  if (!Number.isInteger(idx) || idx < 0) return;
  const buttons = $("qzOptions").querySelectorAll("button");
  if (idx >= buttons.length) return;
  e.preventDefault();
  buttons[idx].click();
}

// ---------- Hiển thị 1 thẻ ----------
function showCard() {
  if (current >= queue.length) return finish();

  const w = queue[current];
  $("idx").textContent = current + 1;
  $("progressBar").style.width = ((current / queue.length) * 100) + "%";
  locked = false;

  ["flashcard", "quiz", "type"].forEach((s) => $(s).classList.add("hidden"));

  const stageId = selMode === "flashcard" ? "flashcard" : selMode === "quiz" ? "quiz" : "type";
  if (selMode === "flashcard") showFlashcard(w);
  else if (selMode === "quiz") showQuiz(w);
  else showType(w);

  // buộc animation chạy lại ở mỗi thẻ mới (kể cả khi cùng 1 stage)
  const stage = $(stageId);
  stage.classList.remove("pop");
  void stage.offsetWidth;
  stage.classList.add("pop");
}

// ----- Flashcard -----
function showFlashcard(w) {
  const stage = $("flashcard");
  stage.classList.remove("hidden");
  $("fcWord").innerHTML = esc(w.word) + (w.ipa ? ` <span class="ipa">${esc(w.ipa)}</span>` : "");
  $("fcMeaning").textContent = w.meaning || "(chưa có nghĩa)";
  const flip = $("flip");
  flip.classList.remove("flipped");
  $("fcGrade").classList.add("hidden");

  $("fcSpeak").onclick = (e) => { e.stopPropagation(); playPron(w.word, w.audio); };

  flip.onclick = () => {
    flip.classList.toggle("flipped");
    // hiện nút chấm điểm sau lần lật đầu (giữ lại kể cả khi lật về mặt trước)
    $("fcGrade").classList.remove("hidden");
  };

  $("fcGrade").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      if (locked) return;
      locked = true;
      grade(w, b.dataset.ok === "1");
    };
  });
}

// ----- Trắc nghiệm -----
function showQuiz(w) {
  const stage = $("quiz");
  stage.classList.remove("hidden");
  $("qzWord").innerHTML = esc(w.word) + (w.ipa ? ` <span class="ipa">${esc(w.ipa)}</span>` : "");
  $("qzSpeak").onclick = () => playPron(w.word, w.audio);

  // tạo 3 đáp án nhiễu từ các từ khác
  const others = allWords
    .filter((x) => x.meaning && x.word !== w.word)
    .map((x) => x.meaning);
  const distractors = shuffle([...new Set(others)]).slice(0, 3);
  const options = shuffle([w.meaning || "(chưa có nghĩa)", ...distractors]);

  const box = $("qzOptions");
  box.innerHTML = "";
  options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.innerHTML = `<span class="kbd-hint">${idx + 1}</span>${esc(opt)}`;
    btn.dataset.opt = opt;
    btn.onclick = () => {
      if (locked) return;
      locked = true;
      const correct = opt === (w.meaning || "(chưa có nghĩa)");
      box.querySelectorAll("button").forEach((b) => {
        b.disabled = true;
        if (b.dataset.opt === (w.meaning || "(chưa có nghĩa)")) b.classList.add("correct");
        else if (b === btn) b.classList.add("incorrect");
      });
      setTimeout(() => grade(w, correct), 750);
    };
    box.appendChild(btn);
  });
}

// ----- Gõ lại -----
function showType(w) {
  const stage = $("type");
  stage.classList.remove("hidden");
  $("tpMeaning").textContent = w.meaning || "(chưa có nghĩa)";
  const input = $("tpInput");
  input.value = "";
  input.disabled = false;
  input.focus();
  $("tpResult").classList.add("hidden");

  const check = () => {
    if (locked) return;
    const ans = input.value.trim().toLowerCase();
    if (!ans) return;
    locked = true;
    const correct = ans === w.word.trim().toLowerCase();
    input.disabled = true;
    const r = $("tpResult");
    r.classList.remove("hidden", "ok", "no");
    if (correct) {
      r.classList.add("ok");
      r.textContent = "✓ Chính xác!";
    } else {
      r.classList.add("no");
      r.textContent = `✗ Đáp án: ${w.word}${w.ipa ? " " + w.ipa : ""}`;
    }
    playPron(w.word, w.audio);
    setTimeout(() => grade(w, correct), 1100);
  };

  $("tpCheck").onclick = check;
  input.onkeydown = (e) => { if (e.key === "Enter") check(); };
}

// ---------- Chấm điểm + cập nhật spaced repetition ----------
function grade(word, ok) {
  if (ok) stats.correct++;
  else stats.wrong++;

  // cập nhật hộp Leitner trong allWordsFull (nguồn đầy đủ, giữ nguyên tombstone của từ khác đã xoá mềm)
  const w = allWordsFull.find((x) => x.id === word.id);
  if (w) {
    if (ok) {
      w.box = Math.min((w.box || 1) + 1, 5);
      w.correct = (w.correct || 0) + 1;
    } else {
      w.box = 1; // sai thì về hộp 1, sẽ hiện lại sớm
      w.wrong = (w.wrong || 0) + 1;
    }
    w.due = Date.now() + BOX_INTERVAL[w.box];
    w.updatedAt = Date.now();
  }

  sessionDoneIds.add(idKey(word));
  current++;

  // gộp cùng 1 lần ghi: mất mạng/đóng tab giữa chừng cũng không lệch dữ liệu
  chrome.storage.local.set({ words: allWordsFull, session: saveSessionState() }, () => {
    showCard();
  });
}

function finish() {
  $("progressBar").style.width = "100%";
  $("session").classList.add("hidden");
  $("done").classList.remove("hidden");
  unlockSidebar();
  const total = stats.correct + stats.wrong;
  $("rCorrect").textContent = stats.correct;
  $("rWrong").textContent = stats.wrong;
  $("rTotal").textContent = total;
  $("rAcc").textContent = (total ? Math.round((stats.correct / total) * 100) : 0) + "%";

  updateStreak();
  renderStreakInto("doneStreak");
  clearSession();

  const remainingPool = getPool().filter((w) => !sessionDoneIds.has(idKey(w)));
  const nextBtn = $("nextRound");
  if (remainingPool.length) {
    nextBtn.textContent = `Vòng tiếp theo (còn ${remainingPool.length} từ)`;
    nextBtn.classList.remove("hidden");
  } else {
    nextBtn.classList.add("hidden");
  }
}

// ---------- Tiện ích ----------
function speak(text) {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) {}
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

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
