# Hướng dẫn nộp bài: ShopVoice → Devpost

**Hạn chót:** 24/10/2026, 02:00 sáng giờ Việt Nam (tức 03:00 GMT+8). Nên nộp trước 22/10 để còn thời gian sửa.
**Trang thi:** https://amazonappdev2026.devpost.com/

Toàn bộ nội dung để dán vào form nằm trong [`DEVPOST_SUBMISSION.md`](DEVPOST_SUBMISSION.md), viết bằng tiếng Anh và đã sẵn sàng. File này chỉ hướng dẫn **dán cái gì vào ô nào** và **làm theo thứ tự nào**.

---

## Bước 1. Đăng video lên YouTube (khoảng 10 phút)

1. File cần đăng:
   - `shopvoice_demo.mp4`: dài 2:40, 1080p. Claude đã gửi trong chat. Nếu mất file, render lại bằng `VIDEO_TTS=piper demo/video/build.sh`.
   - `shopvoice_demo.srt`: phụ đề tiếng Anh.
2. Vào YouTube → **Create → Upload video** → chọn file mp4.
3. **Title:** `ShopVoice: run your grocery shop by voice (Alexa+ MCP server)`
4. **Description** (copy nguyên văn):
   ```
   ShopVoice lets a small grocery owner run the shop by voice: "What's running low?", "How were sales today compared to last Friday?", "Reorder milk and eggs" → "Yes, confirm".
   It is an open-source MCP server (Streamable HTTP, protocol 2025-11-25) for Alexa+, with a voice simulator (Amazon Bedrock agent + Amazon Polly), tenant isolation via Postgres row-level security, and two-step, voice-confirmed reorders.
   Built during Build, Ship, Shape: Amazon Developer Hackathon 2026.
   Code (MIT): https://github.com/vansyson1308/groceryclaw
   Open-source package: https://github.com/vansyson1308/kiotviet-mcp
   ```
5. **Audience:** chọn "No, it's not made for kids".
6. **Subtitles:** phần Subtitles → Upload file → *With timing* → chọn `shopvoice_demo.srt`, ngôn ngữ English.
7. **Visibility:** **Public**, không để Unlisted hay Private, vì luật thi yêu cầu Public.
8. Sau khi đăng, mở link bằng tab ẩn danh để chắc chắn video xem được. Chép lại link, dạng `https://youtu.be/...`.

> Luật thi: video dưới 3 phút, tiếng Anh, không nhạc, không logo Alexa/Echo. Video hiện tại đáp ứng đủ. Giọng đọc là giọng tổng hợp offline, dùng các giọng có giấy phép public domain hoặc CC0.

---

## Bước 2. Điền form Devpost

Vào trang thi → **Enter a submission** hoặc **Edit** → **Create project**.

| Ô trong form Devpost | Dán gì | Lấy từ `DEVPOST_SUBMISSION.md` |
|---|---|---|
| Project name | `ShopVoice` | mục *Project name* |
| Tagline (Elevator pitch) | 1 câu | mục *Tagline* |
| Thumbnail / image | Ảnh 3:2. Gợi ý: `docs/hackathon/evidence/sim-draft-card.png` | (ảnh) |
| **About the project** (Markdown) | Dán **toàn bộ** từ *Inspiration* đến hết *What's next* | mục *About the project* |
| Built with | Các tag cách nhau bằng dấu phẩy | mục *Built with* |
| **"Try it out" links** | 1) https://github.com/vansyson1308/groceryclaw 2) https://github.com/vansyson1308/kiotviet-mcp 3) https://github.com/vansyson1308/groceryclaw/blob/main/docs/hackathon/EVIDENCE.md | mục *Links* |
| **Video demo link** | Link YouTube ở Bước 1 | (link của anh) |
| Image gallery (không bắt buộc) | `evidence/sim-draft-card.png`, `evidence/sim-confirmed.png`, `architecture.png`, `evidence/inspector-local-connected.png` | thư mục `docs/hackathon/` |

### Các câu hỏi riêng của cuộc thi (Additional info)

| Câu hỏi | Chọn hoặc dán gì | Nguồn |
|---|---|---|
| **Track** | **Alexa+** | mục *Track and mini challenges* |
| **Mini challenges** | Tick **AWS Builder** và **Open Source** | như trên |
| Dự án đã có từ trước chưa? | **Có**. Dán đoạn giải thích; baseline là commit `a9f3cdb`, tag `pre-hackathon-baseline` | mục *Pre-existing project: what was built during the window*, kèm link `docs/hackathon/BUILT_DURING_HACKATHON.md` |
| **Product feedback** (từng tool, API, SDK) | Dán cả mục | mục *Product feedback* |
| **Friction log** (được cộng tới +10%) | Dán bảng tóm tắt F1–F12, kèm link file đầy đủ `docs/hackathon/FRICTION_LOG.md` | mục *Friction log* |
| Feature requests | Dán cả mục | mục *Feature requests* |
| **Testing instructions** | Dán cả mục (chạy local 1 phút, không cần tài khoản) | mục *Testing instructions for judges* |
| **Open Source: contribution URL** | https://github.com/vansyson1308/kiotviet-mcp | mục *Open Source mini challenge fields* |
| Open Source: repository URL | https://github.com/vansyson1308/groceryclaw | như trên |
| Open Source: GitHub username | `vansyson1308` | như trên |
| Open Source: short description | Dán đoạn *Short description* | như trên |

> Nếu form có ô không khớp với bảng trên (tên ô có thể khác chút), cứ tìm mục cùng nghĩa trong `DEVPOST_SUBMISSION.md`.

---

## Bước 3. Kiểm tra trước khi bấm Submit (5 phút)

- [ ] Mở link YouTube bằng tab ẩn danh: video chạy được và để **Public**.
- [ ] Mở 2 repo bằng tab ẩn danh: cả hai xem được. Tính đến 26/09 cả hai đều **public**.
- [ ] Mở link `EVIDENCE.md` bằng tab ẩn danh: trang hiển thị bình thường.
- [ ] Đã tick đúng **Track Alexa+** và cả hai **mini challenge**.
- [ ] Trong phần *About*, **câu trung thực về AWS** vẫn còn: bản demo dùng "offline brain" và giọng offline, vì chưa có tài khoản AWS. Không sửa câu này thành "đã chạy trên AWS" khi chưa deploy thật.
- [ ] Bấm **Submit**. Trước hạn chót vẫn có thể quay lại sửa.

---

## (Tùy chọn) Khi có tài khoản AWS

Cho Claude chạy, hoặc tự chạy:

```bash
scripts/aws/deploy.sh --show-secrets      # tạo stack; in ra SimulatorUrl, McpUrl và mã truy cập
scripts/aws/smoke.sh                       # kiểm tra 5 câu hội thoại trên bản đã deploy
node scripts/demo/inspector_evidence.mjs --label deployed
VIDEO_TTS=polly SIM_BRAIN=bedrock demo/video/build.sh   # render lại video với giọng Polly và Bedrock thật
```

Sau đó:
1. thêm `SimulatorUrl` vào "Try it out";
2. gửi mã truy cập riêng trong ô Testing instructions;
3. cập nhật các câu có đánh dấu ⚠️ trong `DEVPOST_SUBMISSION.md`.

Nộp xong nhớ chạy `scripts/aws/teardown.sh` để khỏi tốn tiền.
