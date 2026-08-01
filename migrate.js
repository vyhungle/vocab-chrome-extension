// Chuẩn hoá dữ liệu cũ (trước khi có id/updatedAt/deletedAt) trước khi dùng.
// An toàn khi gọi nhiều lần (idempotent) — mọi entry point đọc "words" nên gọi hàm này trước.
const SCHEMA_VERSION = 2;

function ensureMigrated(callback) {
  chrome.storage.local.get({ schemaVersion: 0, words: [] }, (res) => {
    if (res.schemaVersion >= SCHEMA_VERSION) {
      callback();
      return;
    }

    const words = res.words.map((w) => ({
      ...w,
      id: w.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      updatedAt: w.updatedAt || Date.parse(w.date) || Date.now(),
      deletedAt: w.deletedAt ?? null,
    }));

    chrome.storage.local.set({ words, schemaVersion: SCHEMA_VERSION }, callback);
  });
}
