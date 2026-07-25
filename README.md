# VocabShift

Bôi đen từ tiếng Anh trên web → nhấn **Shift** → popup hiện nghĩa tiếng Việt, phát âm, và lưu từ.

## Tính năng

### Tra & lưu (popup Shift)
- Nghĩa tiếng Việt (API MyMemory miễn phí).
- **Phiên âm IPA** + **audio phát âm thật** (API Free Dictionary). Nút loa ưu tiên audio thật, nếu từ không có thì trình duyệt tự đọc.
- **Chọn bộ từ** khi lưu — mỗi bộ như một "file" riêng. Bấm ＋ để tạo bộ mới ngay.
- **Gắn level A1–C2** cho từng từ.
- Lưu vào máy bằng chrome.storage (offline).

### Quản lý (bấm icon extension)
- Xem danh sách từ, **lọc theo bộ và level**.
- Phát âm lại, xóa từng từ.
- Xuất CSV (gồm cả bộ + level), xóa hết.

### Ôn tập (nút 📚 Ôn tập)
Mở trang ôn riêng. Chọn bộ + level, rồi chọn:

**3 kiểu ôn:**
- **Flashcard** — lật thẻ, tự chấm "Nhớ / Chưa nhớ".
- **Trắc nghiệm** — chọn nghĩa đúng trong 4 đáp án.
- **Gõ lại từ** — nhìn nghĩa, gõ lại từ tiếng Anh.

**2 chế độ:**
- **Đến hạn (thông minh)** — spaced repetition kiểu Leitner: trả lời đúng thì từ giãn ra xa (1 → 3 → 7 → 16 ngày), sai thì quay về ôn sớm.
- **Ôn tất cả** — ôn toàn bộ từ trong bộ/level đã chọn, không theo lịch.

## Cách cài (chế độ nhà phát triển)
1. Mở Chrome → `chrome://extensions`.
2. Bật **Developer mode** (góc trên phải).
3. **Load unpacked** → chọn thư mục `vocab-shift-extension`.

## Cách dùng nhanh
1. Bôi đen 1 từ (≤4 từ) trên web → nhấn **Shift**.
2. Chọn bộ + level → 💾 Lưu.
3. Bấm icon extension → 📚 Ôn tập để ôn lại.

## Ghi chú
- Tra nghĩa + IPA + audio cần mạng; phần lưu và ôn tập chạy offline (audio thật đã lưu vẫn cần mạng để phát).
- Dữ liệu spaced repetition (hộp, ngày đến hạn) tự cập nhật sau mỗi lần ôn.
