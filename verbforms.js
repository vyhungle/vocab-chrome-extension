// Bảng động từ bất quy tắc [V1, V2 - quá khứ đơn, V3 - quá khứ phân từ].
// Dùng để tự nhận diện và gắn nhãn "V2"/"V3" khi từ đã lưu là một dạng chia
// (vd "stolen" -> V3 của "steal"). Nhận diện theo chữ nên áp dụng được luôn
// cho cả từ đã lưu từ trước, không cần cập nhật lại dữ liệu cũ.
const IRREGULAR_VERBS = [
  ["be", "was/were", "been"], ["become", "became", "become"], ["begin", "began", "begun"],
  ["bend", "bent", "bent"], ["bet", "bet", "bet"], ["bind", "bound", "bound"],
  ["bite", "bit", "bitten"], ["bleed", "bled", "bled"], ["blow", "blew", "blown"],
  ["break", "broke", "broken"], ["breed", "bred", "bred"], ["bring", "brought", "brought"],
  ["build", "built", "built"], ["burn", "burnt", "burnt"], ["burst", "burst", "burst"],
  ["buy", "bought", "bought"], ["catch", "caught", "caught"], ["choose", "chose", "chosen"],
  ["come", "came", "come"], ["cost", "cost", "cost"], ["creep", "crept", "crept"],
  ["cut", "cut", "cut"], ["deal", "dealt", "dealt"], ["dig", "dug", "dug"],
  ["do", "did", "done"], ["draw", "drew", "drawn"], ["dream", "dreamt", "dreamt"],
  ["drink", "drank", "drunk"], ["drive", "drove", "driven"], ["eat", "ate", "eaten"],
  ["fall", "fell", "fallen"], ["feed", "fed", "fed"], ["feel", "felt", "felt"],
  ["fight", "fought", "fought"], ["find", "found", "found"], ["flee", "fled", "fled"],
  ["fly", "flew", "flown"], ["forbid", "forbade", "forbidden"], ["forget", "forgot", "forgotten"],
  ["forgive", "forgave", "forgiven"], ["freeze", "froze", "frozen"], ["get", "got", "gotten"],
  ["give", "gave", "given"], ["go", "went", "gone"], ["grow", "grew", "grown"],
  ["hang", "hung", "hung"], ["have", "had", "had"], ["hear", "heard", "heard"],
  ["hide", "hid", "hidden"], ["hit", "hit", "hit"], ["hold", "held", "held"],
  ["hurt", "hurt", "hurt"], ["keep", "kept", "kept"], ["kneel", "knelt", "knelt"],
  ["know", "knew", "known"], ["lay", "laid", "laid"], ["lead", "led", "led"],
  ["lean", "leant", "leant"], ["leap", "leapt", "leapt"], ["learn", "learnt", "learnt"],
  ["leave", "left", "left"], ["lend", "lent", "lent"], ["let", "let", "let"],
  ["lie", "lay", "lain"], ["light", "lit", "lit"], ["lose", "lost", "lost"],
  ["make", "made", "made"], ["mean", "meant", "meant"], ["meet", "met", "met"],
  ["mistake", "mistook", "mistaken"], ["pay", "paid", "paid"], ["put", "put", "put"],
  ["quit", "quit", "quit"], ["read", "read", "read"], ["ride", "rode", "ridden"],
  ["ring", "rang", "rung"], ["rise", "rose", "risen"], ["run", "ran", "run"],
  ["say", "said", "said"], ["see", "saw", "seen"], ["sell", "sold", "sold"],
  ["send", "sent", "sent"], ["set", "set", "set"], ["sew", "sewed", "sewn"],
  ["shake", "shook", "shaken"], ["shine", "shone", "shone"], ["shoot", "shot", "shot"],
  ["show", "showed", "shown"], ["shrink", "shrank", "shrunk"], ["shut", "shut", "shut"],
  ["sing", "sang", "sung"], ["sink", "sank", "sunk"], ["sit", "sat", "sat"],
  ["sleep", "slept", "slept"], ["slide", "slid", "slid"], ["smell", "smelt", "smelt"],
  ["speak", "spoke", "spoken"], ["speed", "sped", "sped"], ["spell", "spelt", "spelt"],
  ["spend", "spent", "spent"], ["spill", "spilt", "spilt"], ["spin", "spun", "spun"],
  ["spit", "spat", "spat"], ["split", "split", "split"], ["spoil", "spoilt", "spoilt"],
  ["spread", "spread", "spread"], ["spring", "sprang", "sprung"], ["stand", "stood", "stood"],
  ["steal", "stole", "stolen"], ["stick", "stuck", "stuck"], ["sting", "stung", "stung"],
  ["stink", "stank", "stunk"], ["strike", "struck", "struck"], ["swear", "swore", "sworn"],
  ["sweep", "swept", "swept"], ["swell", "swelled", "swollen"], ["swim", "swam", "swum"],
  ["swing", "swung", "swung"], ["take", "took", "taken"], ["teach", "taught", "taught"],
  ["tear", "tore", "torn"], ["tell", "told", "told"], ["think", "thought", "thought"],
  ["throw", "threw", "thrown"], ["understand", "understood", "understood"],
  ["upset", "upset", "upset"], ["wake", "woke", "woken"], ["wear", "wore", "worn"],
  ["weep", "wept", "wept"], ["win", "won", "won"], ["wind", "wound", "wound"],
  ["withdraw", "withdrew", "withdrawn"], ["write", "wrote", "written"],
];

// Tra theo BẤT KỲ dạng nào (V1, V2 hoặc V3) -> động từ bất quy tắc chứa nó,
// để khi khớp 1 dạng là có thể hiện luôn cả 3 dạng V1 - V2 - V3.
const VERB_TRIPLE_MAP = (() => {
  const map = {};
  IRREGULAR_VERBS.forEach(([v1, v2, v3]) => {
    const forms = new Set();
    [v1, v2, v3].forEach((f) => f.split("/").forEach((p) => forms.add(p.trim().toLowerCase())));
    forms.forEach((key) => {
      if (!map[key]) map[key] = { v1, v2, v3 };
    });
  });
  return map;
})();

// Trả {label, v1, v2, v3} nếu từ trùng 1 dạng chia của động từ bất quy tắc đã biết; null nếu không.
// label là "V1"/"V2"/"V3" (gộp bằng "/" nếu từ trùng nhiều dạng cùng lúc, vd "cut").
function getVerbFormInfo(word) {
  const key = String(word || "").trim().toLowerCase();
  if (!key) return null;
  const info = VERB_TRIPLE_MAP[key];
  if (info) {
    const labels = [];
    if (info.v1.toLowerCase() === key) labels.push("V1");
    if (info.v2.toLowerCase().split("/").some((f) => f.trim() === key)) labels.push("V2");
    if (info.v3.toLowerCase().split("/").some((f) => f.trim() === key)) labels.push("V3");
    return { label: labels.join("/"), v1: info.v1, v2: info.v2, v3: info.v3 };
  }
  return guessRegularVerbForm(key);
}

// Vài trăm động từ thông dụng tận cùng bằng "e" câm (love, hope, bake...) — dùng để
// đoán đúng gốc khi gặp dạng "-ed": "loved" nên đoán ra "love" chứ không phải "lov".
const SILENT_E_VERBS = new Set([
  "accuse", "achieve", "advise", "agree", "amaze", "amuse", "announce", "argue", "arrange",
  "arrive", "bake", "balance", "bathe", "believe", "blame", "bore", "bounce", "bribe", "care",
  "cause", "change", "charge", "chase", "choke", "close", "combine", "come", "complete",
  "continue", "create", "cure", "dance", "date", "decide", "declare", "decrease", "define",
  "delete", "deserve", "desire", "die", "dine", "dislike", "dive", "divide", "doze", "drive",
  "erase", "escape", "examine", "exchange", "excite", "exercise", "exclude", "excuse", "explode",
  "explore", "expose", "file", "fire", "free", "guide", "hate", "hike", "hire", "hope", "imagine",
  "include", "increase", "introduce", "invite", "issue", "joke", "judge", "like", "line", "live",
  "locate", "love", "manage", "measure", "mistake", "move", "name", "note", "notice", "observe",
  "operate", "organize", "owe", "phone", "pile", "place", "please", "practice", "prepare",
  "produce", "promise", "propose", "provide", "raise", "rate", "realize", "receive", "recognize",
  "reduce", "refuse", "relate", "release", "rely", "remove", "replace", "require", "rescue",
  "resolve", "retire", "save", "scale", "score", "serve", "settle", "shake", "share", "shine",
  "skate", "slice", "slide", "smile", "smoke", "solve", "sponsor", "state", "store", "stare",
  "surprise", "taste", "tie", "trace", "trade", "translate", "use", "value", "vote", "waste",
  "wave",
]);

// Vài ngoại lệ "-ied" không theo quy tắc phụ âm+y (chúng vốn đã tận cùng "ie", chỉ thêm "d").
const IED_EXCEPTIONS = { died: "die", tied: "tie", lied: "lie", vied: "vie" };

// Đoán động từ CÓ quy tắc từ dạng "-ed" theo chính tả tiếng Anh (gấp đôi phụ âm,
// đổi "y" -> "ied", gốc tận cùng "e" câm...). Trả {label:"V2/V3", v1, v2, v3, guessed:true}
// hoặc null nếu từ không có dạng "-ed" hoặc quá ngắn để đoán an toàn.
function guessRegularVerbForm(key) {
  if (!/^[a-z]+ed$/.test(key) || key.length < 4) return null;

  let base;
  if (IED_EXCEPTIONS[key]) {
    base = IED_EXCEPTIONS[key];
  } else if (key.endsWith("ied")) {
    base = key.slice(0, -3) + "y"; // studied -> study, carried -> carry
  } else {
    const last2 = key.slice(-4, -2); // 2 ký tự ngay trước "ed"
    if (last2.length === 2 && last2[0] === last2[1] && !"aeiou".includes(last2[0])) {
      base = key.slice(0, -3); // stopped -> stop, planned -> plan (bỏ 1 phụ âm lặp)
    } else {
      const stem = key.slice(0, -2); // bỏ "ed": walked -> walk, loved -> lov
      base = SILENT_E_VERBS.has(stem + "e") ? stem + "e" : stem; // lov+e -> love nếu có trong danh sách
    }
  }
  if (!base || base === key) return null;
  return { label: "V2/V3", v1: base, v2: key, v3: key, guessed: true };
}

// Đoạn HTML nhỏ để chèn ngay sau từ/phiên âm: 1 nhãn nhỏ bấm được (vd "V3"),
// bấm vào mới xổ dòng V1 - V2 - V3 nhỏ bên dưới. Cần gọi bindVerbFormToggle()
// một lần trên vùng cha chứa nó để nút bấm hoạt động.
function verbFormSuffixHtml(word) {
  const info = getVerbFormInfo(word);
  if (!info || !info.label) return "";
  const mark = info.guessed ? "?" : ""; // đoán theo quy tắc chính tả, không chắc chắn như bảng bất quy tắc
  const title = info.guessed ? "Đoán theo quy tắc -ed, có thể không chính xác" : "Xem V1 - V2 - V3";
  // mỗi dạng 1 màu riêng (xem class .vf-v1/.vf-v2/.vf-v3); hover hiện tooltip CSS riêng
  // (data-tip, không dùng "title") để hiện ngay lập tức, không bị độ trễ tooltip mặc định của trình duyệt.
  const TAG_HINT = { V1: "V1 — nguyên mẫu", V2: "V2 — quá khứ đơn", V3: "V3 — quá khứ phân từ" };
  const row = (tag, form) => `<span class="vf-form vf-${tag.toLowerCase()}" data-tip="${TAG_HINT[tag]}">${form}</span>`;
  return (
    ` <button type="button" class="vform-badge${info.guessed ? " guessed" : ""}" title="${title}">${info.label}${mark}</button>` +
    `<div class="vform-detail">${row("V1", info.v1)} <span class="vf-sep">→</span> ${row("V2", info.v2)} <span class="vf-sep">→</span> ${row("V3", info.v3)}</div>`
  );
}

// Gắn 1 lần trên phần tử cha (list, popup...) để bấm nút .vform-badge bên trong
// sẽ ẩn/hiện .vform-detail đi liền sau nó. An toàn khi gọi nhiều lần.
function bindVerbFormToggle(container) {
  if (!container || container.__vformBound) return;
  container.__vformBound = true;
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".vform-badge");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const detail = btn.nextElementSibling;
    if (detail && detail.classList.contains("vform-detail")) detail.classList.toggle("open");
  });
}
