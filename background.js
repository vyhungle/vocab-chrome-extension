// Xử lý các yêu cầu từ content script (fetch chạy ở background để tránh CORS)
// Nghĩa và phát âm tách thành 2 message riêng để content script hiện được
// cái nào xong trước, không phải đợi cả 2 (API dịch/IPA nhanh chậm khác nhau).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "MEANING") {
    translateWord(msg.word)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // giữ kênh mở cho phản hồi bất đồng bộ
  }
  if (msg.type === "PRONOUNCE") {
    handlePronounce(msg.word)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function handlePronounce(word) {
  // chạy song song: IPA/audio (dictionary) + IPA dự phòng/level (datamuse)
  const [dict, dm] = await Promise.all([
    lookupDictionary(word).catch(() => ({ ipa: "", audio: "" })),
    lookupDatamuse(word).catch(() => ({ ipa: "", level: "" })),
  ]);
  return {
    ipa: dict.ipa || dm.ipa || "", // ưu tiên IPA giọng Anh của dictionary
    audio: dict.audio || "",
    level: dm.level || "", // level CEFR gợi ý theo tần suất từ
  };
}

// ---- Dịch nghĩa (MyMemory, EN -> VI) ----
async function translateWord(word) {
  const q = encodeURIComponent(word.trim());
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|vi`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();

  let meaning = json?.responseData?.translatedText || "";
  const alts = [];
  if (Array.isArray(json?.matches)) {
    for (const m of json.matches) {
      const t = (m.translation || "").trim();
      if (t && t.toLowerCase() !== meaning.toLowerCase() && !alts.includes(t)) {
        alts.push(t);
      }
      if (alts.length >= 3) break;
    }
  }
  return { meaning, alternatives: alts };
}

// ---- IPA + audio (Free Dictionary API, có dự phòng Datamuse) ----
async function lookupDictionary(word) {
  const q = encodeURIComponent(word.trim().toLowerCase());
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${q}`;

  let ipa = "";
  let audio = "";
  let audioScore = -1; // ưu tiên phát âm Anh-Mỹ (us) hơn các giọng khác (uk/au/in...)
  try {
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json)) {
        for (const entry of json) {
          if (entry.phonetic && !ipa) ipa = entry.phonetic;
          if (Array.isArray(entry.phonetics)) {
            for (const p of entry.phonetics) {
              if (p.text && !ipa) ipa = p.text;
              if (p.audio) {
                const score = accentScore(p.audio);
                if (score > audioScore) {
                  audioScore = score;
                  audio = p.audio.startsWith("//") ? "https:" + p.audio : p.audio;
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // bỏ qua, sẽ thử nguồn dự phòng bên dưới
  }

  return { ipa, audio };
}

// Free Dictionary API trả nhiều audio (us/uk/au...) không theo thứ tự cố định
// -> chấm điểm để luôn chọn giọng Mỹ nếu có, thay vì lấy audio đầu tiên tìm thấy.
function accentScore(audioUrl) {
  const u = audioUrl.toLowerCase();
  if (/-us(\.|_)|\/us\//.test(u)) return 2;
  if (/-uk(\.|_)|\/uk\//.test(u)) return 0;
  return 1; // giọng khác (au, in...) hoặc không rõ -> ưu tiên hơn uk, kém hơn us
}

// ---- Datamuse (từ điển CMU): IPA dự phòng + level gợi ý theo tần suất ----
async function lookupDatamuse(word) {
  const q = encodeURIComponent(word.trim().toLowerCase());
  const url = `https://api.datamuse.com/words?sp=${q}&md=rf&max=1`;
  const res = await fetch(url);
  if (!res.ok) return { ipa: "", level: "" };
  const json = await res.json();
  const tags = json?.[0]?.tags || [];

  let ipa = "";
  const pron = tags.find((t) => t.startsWith("pron:"));
  if (pron) {
    const arp = arpabetToIpa(pron.slice(5).trim());
    if (arp) ipa = `/${arp}/`;
  }

  let level = "";
  const f = tags.find((t) => t.startsWith("f:"));
  if (f) level = freqToLevel(parseFloat(f.slice(2)));

  return { ipa, level };
}

// Suy ra CEFR từ tần suất (số lần/1 triệu từ). Chỉ là gợi ý tương đối.
function freqToLevel(f) {
  if (!(f > 0)) return "";
  if (f >= 100) return "A1";
  if (f >= 30) return "A2";
  if (f >= 8) return "B1";
  if (f >= 3) return "B2";
  if (f >= 1) return "C1";
  return "C2";
}

// Bảng chuyển Arpabet -> IPA (39 âm vị CMU)
const ARPABET_IPA = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ",
  B: "b", CH: "tʃ", D: "d", DH: "ð", EH: "ɛ", ER: "ɝ", EY: "eɪ",
  F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "i", JH: "dʒ", K: "k",
  L: "l", M: "m", N: "n", NG: "ŋ", OW: "oʊ", OY: "ɔɪ", P: "p",
  R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "u",
  V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};

function arpabetToIpa(arpabet) {
  const parts = arpabet.split(/\s+/).filter(Boolean);
  let out = "";
  for (const p of parts) {
    const m = p.match(/^([A-Z]+)(\d?)$/);
    if (!m) continue;
    let sym = m[1];
    const stress = m[2];
    // âm vị không trọng âm 0 dịu hơn
    if (sym === "AH" && stress === "0") sym = "AH0";
    let ipa = sym === "AH0" ? "ə" : ARPABET_IPA[sym] || "";
    if (sym === "ER" && stress === "0") ipa = "ɚ";
    if (!ipa) continue;
    if (stress === "1") out += "ˈ" + ipa;
    else if (stress === "2") out += "ˌ" + ipa;
    else out += ipa;
  }
  return out;
}
