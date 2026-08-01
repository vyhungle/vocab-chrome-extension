// Đồng bộ dữ liệu từ vựng với Supabase: pull -> merge (last-write-wins theo updatedAt) -> push.
// Xoá mềm (deletedAt) đi qua sync như 1 field bình thường, KHÔNG lọc ở đây -> việc xoá mới
// đồng bộ được giữa các máy. Lọc !deletedAt chỉ làm ở tầng hiển thị (popup.js/review.js).

async function syncNow() {
  const session = await ensureFreshSession();
  if (!session) return { ok: false, reason: "Chưa đăng nhập" };

  try {
    const { words: localWords, lastSyncedAt } = await new Promise((resolve) => {
      chrome.storage.local.get({ words: [], lastSyncedAt: null }, resolve);
    });

    const remoteWords = await pullRemote(lastSyncedAt);
    const merged = mergeWordArrays(localWords, remoteWords);

    // chỉ đẩy lên những gì local đã đổi kể từ lần sync trước (tính trên mảng local gốc)
    const toPush = localWords.filter((w) => (w.updatedAt || 0) > (lastSyncedAt || 0));
    if (toPush.length) await pushRemote(toPush);

    const now = Date.now();
    await new Promise((resolve) => {
      chrome.storage.local.set({ words: merged, lastSyncedAt: now }, resolve);
    });

    return { ok: true, pulled: remoteWords.length, pushed: toPush.length };
  } catch (e) {
    // lỗi mạng/API -> KHÔNG cập nhật lastSyncedAt, lần sau tự retry đúng khoảng đó
    return { ok: false, reason: e.message || String(e) };
  }
}

async function pullRemote(lastSyncedAt) {
  let path = "/rest/v1/words?select=*";
  if (lastSyncedAt) {
    path += `&updated_at=gt.${encodeURIComponent(new Date(lastSyncedAt).toISOString())}`;
  }
  const res = await authFetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Không tải được dữ liệu (HTTP ${res.status})`);
  const rows = await res.json();
  return rows.map(remoteToLocal);
}

async function pushRemote(localWordsToPush) {
  const rows = localWordsToPush.map(localToRemote);
  const res = await authFetch("/rest/v1/words?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Không đẩy được dữ liệu lên (HTTP ${res.status}) ${errText}`);
  }
}

// ---------- Chuyển đổi field: local (camelCase, ms epoch) <-> Supabase (snake_case, ISO) ----------
function remoteToLocal(row) {
  return {
    id: row.id,
    word: row.word,
    meaning: row.meaning || "",
    deck: row.deck || "Mặc định",
    level: row.level || "",
    ipa: row.ipa || "",
    audio: row.audio || "",
    date: row.date,
    source: row.source || "",
    box: row.box ?? 1,
    correct: row.correct ?? 0,
    wrong: row.wrong ?? 0,
    due: Date.parse(row.due) || Date.now(),
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : null,
  };
}

function localToRemote(w) {
  return {
    id: w.id,
    word: w.word,
    meaning: w.meaning || "",
    deck: w.deck || "Mặc định",
    level: w.level || "",
    ipa: w.ipa || "",
    audio: w.audio || "",
    date: w.date,
    source: w.source || "",
    box: w.box ?? 1,
    correct: w.correct ?? 0,
    wrong: w.wrong ?? 0,
    due: new Date(w.due || Date.now()).toISOString(),
    updated_at: new Date(w.updatedAt || Date.now()).toISOString(),
    deleted_at: w.deletedAt ? new Date(w.deletedAt).toISOString() : null,
  };
}

// Merge thuần theo id, last-write-wins theo updatedAt. Tái dùng được cho Import sau này.
function mergeWordArrays(localWords, remoteWords) {
  const map = new Map();
  localWords.forEach((w) => map.set(w.id, w));
  remoteWords.forEach((r) => {
    const local = map.get(r.id);
    if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) {
      map.set(r.id, r);
    }
  });
  return [...map.values()];
}
