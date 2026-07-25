// ---------- Tham số ----------
const params = new URLSearchParams(location.search);
const DAY = 24 * 60 * 60 * 1000;
// khoảng cách ôn lại theo hộp Leitner (box 1..5)
const BOX_INTERVAL = [0, 0, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY];

let allWords = [];
let queue = [];
let current = 0;
let stats = { correct: 0, wrong: 0 };
let selMode = "flashcard";
let selSchedule = "srs";

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);

// ---------- Khởi tạo ----------
chrome.storage.local.get({ words: [], decks: ["Mặc định"] }, (res) => {
  allWords = res.words;

  // nạp danh sách bộ (kèm số đếm + số đến hạn)
  const now = Date.now();
  const decks = new Set(res.decks);
  allWords.forEach((w) => w.deck && decks.add(w.deck));
  const count = {}, due = {};
  allWords.forEach((w) => {
    const d = w.deck || "Mặc định";
    count[d] = (count[d] || 0) + 1;
    if ((w.due ?? 0) <= now) due[d] = (due[d] || 0) + 1;
  });
  $("deck").innerHTML =
    `<option value="">Tất cả bộ (${allWords.length})</option>` +
    [...decks]
      .map((d) => {
        const dueTxt = due[d] ? ` · ${due[d]} đến hạn` : "";
        return `<option value="${esc(d)}">${esc(d)} — ${count[d] || 0} từ${dueTxt}</option>`;
      })
      .join("");

  // áp bộ lọc từ URL (mở từ popup)
  if (params.get("deck")) $("deck").value = params.get("deck");
  if (params.get("level")) $("level").value = params.get("level");

  renderDash();
  updatePoolInfo();
  updateScheduleHint();
});

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
$("deck").addEventListener("change", updatePoolInfo);
$("level").addEventListener("change", updatePoolInfo);

function getPool() {
  const d = $("deck").value;
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
    renderDash();
    updatePoolInfo();
  });
});

// ---------- Hiển thị 1 thẻ ----------
function showCard() {
  if (current >= queue.length) return finish();

  const w = queue[current];
  $("idx").textContent = current + 1;
  $("progressBar").style.width = ((current / queue.length) * 100) + "%";

  ["flashcard", "quiz", "type"].forEach((s) => $(s).classList.add("hidden"));

  if (selMode === "flashcard") showFlashcard(w);
  else if (selMode === "quiz") showQuiz(w);
  else showType(w);
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
    flip.classList.add("flipped");
    $("fcGrade").classList.remove("hidden");
  };

  $("fcGrade").querySelectorAll("button").forEach((b) => {
    b.onclick = () => grade(w, b.dataset.ok === "1");
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
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.onclick = () => {
      const correct = opt === (w.meaning || "(chưa có nghĩa)");
      box.querySelectorAll("button").forEach((b) => {
        b.disabled = true;
        if (b.textContent === (w.meaning || "(chưa có nghĩa)")) b.classList.add("correct");
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
    const ans = input.value.trim().toLowerCase();
    if (!ans) return;
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
  $("rCorrect").textContent = stats.correct;
  $("rWrong").textContent = stats.wrong;
  $("rTotal").textContent = stats.correct + stats.wrong;
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
