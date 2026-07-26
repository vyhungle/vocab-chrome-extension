// ---------- Tham số ----------
const params = new URLSearchParams(location.search);
const DAY = 24 * 60 * 60 * 1000;
// khoảng cách ôn lại theo hộp Leitner (box 1..5)
const BOX_INTERVAL = [0, 0, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY];

let allWords = [];
let allDecks = [];
let queue = [];
let current = 0;
let stats = { correct: 0, wrong: 0 };
let selMode = "flashcard";
let selSchedule = "srs";
let selDeck = "";
let locked = false; // chặn chấm điểm 2 lần khi đang chờ setTimeout hoặc bấm phím dồn dập
let streak = { last: "", count: 0 };

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);

// ---------- Khởi tạo ----------
chrome.storage.local.get({ words: [], decks: ["Mặc định"], streak: { last: "", count: 0 } }, (res) => {
  allWords = res.words;
  streak = res.streak || { last: "", count: 0 };

  const decks = new Set(res.decks);
  allWords.forEach((w) => w.deck && decks.add(w.deck));
  allDecks = [...decks];

  // áp bộ lọc từ URL (mở từ popup)
  if (params.get("deck")) selDeck = params.get("deck");
  if (params.get("level")) $("level").value = params.get("level");

  renderDeckGrid();
  renderDash();
  renderStreakInto("streak");
  updatePoolInfo();
  updateScheduleHint();
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
    { name: "", label: "Tất cả bộ", c: allWords.length, d: totalDue },
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
      const dueTxt = c.d ? ` · <span class="due-count">${c.d} đến hạn</span>` : "";
      return `<button type="button" class="deck-card${active}" data-deck="${esc(c.name)}">
        <span class="dn">${esc(c.label)}</span>
        <span class="dc">${c.c} từ${dueTxt}</span>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".deck-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      selDeck = btn.dataset.deck;
      grid.querySelectorAll(".deck-card").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updatePoolInfo();
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
    <div class="stat"><b>${total}</b><small>Tổng từ</small></div>
    <div class="stat due"><b>${dueN}</b><small>Đến hạn</small></div>
    <div class="stat mastered"><b>${mastered}</b><small>Đã thuộc</small></div>
    <div class="stat"><b>${acc}%</b><small>Đúng · ${learning} đang học</small></div>
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
  if (selSchedule === "srs") {
    $("poolInfo").textContent = n
      ? `${n} từ đến hạn ôn.`
      : "Không có từ nào đến hạn. Chọn “Ôn tất cả” để ôn ngay.";
  } else {
    $("poolInfo").textContent = `${n} từ sẽ được ôn.`;
  }
}

function updateScheduleHint() {
  $("scheduleHint").textContent =
    selSchedule === "srs"
      ? "Chỉ ôn những từ đến hạn; từ sai sẽ hiện lại sớm hơn."
      : "Ôn toàn bộ từ trong bộ/level đã chọn.";
}

// ---------- Bắt đầu ----------
$("start").addEventListener("click", () => {
  queue = shuffle(getPool());
  if (!queue.length) {
    alert("Không có từ nào để ôn với lựa chọn hiện tại.");
    return;
  }
  current = 0;
  stats = { correct: 0, wrong: 0 };
  $("setup").classList.add("hidden");
  $("done").classList.add("hidden");
  $("session").classList.remove("hidden");
  $("total").textContent = queue.length;
  showCard();
});

$("again").addEventListener("click", () => {
  $("done").classList.add("hidden");
  $("setup").classList.remove("hidden");
  // nạp lại dữ liệu mới nhất
  chrome.storage.local.get({ words: [] }, (res) => {
    allWords = res.words;
    renderDeckGrid();
    renderDash();
    renderStreakInto("streak");
    updatePoolInfo();
  });
});

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

  // cập nhật hộp Leitner trong allWords
  const w = allWords.find(
    (x) => x.word === word.word && x.deck === word.deck && x.date === word.date
  );
  if (w) {
    if (ok) {
      w.box = Math.min((w.box || 1) + 1, 5);
      w.correct = (w.correct || 0) + 1;
    } else {
      w.box = 1; // sai thì về hộp 1, sẽ hiện lại sớm
      w.wrong = (w.wrong || 0) + 1;
    }
    w.due = Date.now() + BOX_INTERVAL[w.box];
  }

  chrome.storage.local.set({ words: allWords }, () => {
    current++;
    showCard();
  });
}

function finish() {
  $("progressBar").style.width = "100%";
  $("session").classList.add("hidden");
  $("done").classList.remove("hidden");
  const total = stats.correct + stats.wrong;
  $("rCorrect").textContent = stats.correct;
  $("rWrong").textContent = stats.wrong;
  $("rTotal").textContent = total;
  $("rAcc").textContent = (total ? Math.round((stats.correct / total) * 100) : 0) + "%";

  updateStreak();
  renderStreakInto("doneStreak");
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
