# Hướng dẫn nộp bài: ShopVoice → Devpost

**Hạn chót:** Devpost đóng lúc **12:00 trưa 23/10 giờ Thái Bình Dương = 02:00 sáng 24/10 giờ Việt Nam**. Kế hoạch là anh **bấm Submit trước 00:00 ngày 24/10** để còn 2 tiếng dự phòng.
**Trang thi:** https://amazonappdev2026.devpost.com/

Toàn bộ chữ để dán vào form nằm trong [`DEVPOST_SUBMISSION.md`](DEVPOST_SUBMISSION.md), viết bằng tiếng Anh. File này chỉ hướng dẫn **dán cái gì vào ô nào, theo thứ tự nào**. Trước khi nộp, `FINAL_QC.md` phải xanh, và chỉ còn đúng một việc của anh: thay link YouTube vào chỗ đánh dấu ⟪OWNER⟫ trong `DEVPOST_SUBMISSION.md` và `README.md`.

---

## Bước 1. Đăng video lên YouTube (khoảng 10 phút)

1. **File cần đăng** (Claude gửi trong chat và ghi đường dẫn trong tin nhắn bàn giao):
   - `shopvoice_demo.mp4`: dưới 2:50, 1080p, tiếng Anh, có phụ đề tiếng Anh in sẵn;
   - `shopvoice_demo.srt`: file phụ đề tiếng Anh;
   - `thumbnail.png`: ảnh bìa tỷ lệ 3:2 cho Devpost (YouTube cũng nhận ảnh này).
2. YouTube → **Create → Upload video** → chọn file mp4.
3. **Title:** `ShopVoice: an agent that watches the corner shop, by voice (Alexa+ MCP)`
4. **Description** (copy nguyên văn):
   ```
   ShopVoice is a voice agent for small grocery shops. One spoken request gives the morning briefing and a reorder plan grouped by supplier; it remembers the owner's rules across days ("always order eggs from Dawn Bakery & Farm"), answers in English or Vietnamese, and never buys anything without an explicit spoken "yes".
   Shown: a simulated Alexa+ experience (our own web page acting as an MCP client) on the hosted demo, with Claude planning the tool calls. Underneath is a standard MCP server (Streamable HTTP, protocol 2025-11-25) with Postgres row-level security.
   Try it: https://shopvoice-78h7.onrender.com
   Code (MIT): https://github.com/vansyson1308/groceryclaw
   Open-source package: https://github.com/vansyson1308/kiotviet-mcp
   Built during Build, Ship, Shape: Amazon Developer Hackathon 2026. Not affiliated with Amazon.
   Voices: Piper (public domain / CC0 English voices; Vietnamese voice from the VAIS-1000 corpus, CC BY 4.0).
   Editing note: the live segment was recorded on the hosted demo; the wait before each reply (4-5 s) is shortened to 2.5 s to fit under three minutes. Real latency is in docs/hackathon/EVIDENCE.md (H2).
   ```
5. **Tags:** `ShopVoice, MCP, Model Context Protocol, Alexa+, voice assistant, grocery, Vietnam, Claude, open source, hackathon`
6. **Audience:** chọn "No, it's not made for kids".
7. **Subtitles:** mục Subtitles → **Upload file → With timing** → chọn `shopvoice_demo.srt`, ngôn ngữ English.
8. **Visibility:** chọn **Public**. Không để Unlisted hay Private: luật thi yêu cầu Public.
9. Mở link bằng **tab ẩn danh** để chắc chắn ai cũng xem được. Chép link dạng `https://youtu.be/...` gửi Claude để em điền vào `DEVPOST_SUBMISSION.md`, hoặc anh tự thay chỗ đánh dấu ⟪OWNER⟫ trong `DEVPOST_SUBMISSION.md` và `README.md`.

---

## Bước 2. Điền form Devpost (khoảng 20 phút)

Vào trang thi → **Enter a submission** (hoặc **Edit** bản nháp "Untitled" đang có).

| Ô trong form | Dán gì | Lấy từ mục nào trong `DEVPOST_SUBMISSION.md` |
|---|---|---|
| Project name | `ShopVoice` | *Project name* |
| Elevator pitch / Tagline | Một câu | *Tagline* |
| Thumbnail | `thumbnail.png` (3:2) | (file) |
| **About the project** (Markdown) | Dán **toàn bộ** từ *Inspiration* đến hết *What's next*, gồm cả bảng *Before → after* | *About the project* |
| Built with | Các tag, cách nhau bằng dấu phẩy | *Built with* |
| **"Try it out" links** | 1) link simulator trên Render; 2) https://github.com/vansyson1308/groceryclaw; 3) https://github.com/vansyson1308/kiotviet-mcp | *Links* |
| **Video demo link** | Link YouTube ở Bước 1 | (link của anh) |
| Image gallery (không bắt buộc) | `docs/hackathon/architecture.png` và các ảnh `docs/hackathon/evidence/inspector-deployed-*.png` | (file) |

### Các câu hỏi riêng của cuộc thi (Additional info)

| Câu hỏi | Chọn hoặc dán gì | Nguồn |
|---|---|---|
| **Track** | **Alexa+** | *Track and mini challenges* |
| **Mini challenges** | Tick **Open Source**. Tick **AWS Builder** **chỉ khi** PR Kiro đã merge; Claude sẽ ghi rõ trong tin nhắn bàn giao | như trên |
| Dự án có từ trước không? | **Có**. Dán đoạn giải thích; baseline là tag `pre-hackathon-baseline` | *Pre-existing project: what changed during the window* |
| **Product Feedback** (từng công cụ) | Dán **cả mục**, mỗi công cụ một khối; câu "AWS services" nằm ở cuối mục | *Product feedback* |
| **Friction Log** (được cộng tới 10%) | Dán bảng, kèm link `https://github.com/vansyson1308/groceryclaw/blob/main/docs/hackathon/FRICTION_LOG.md` | *Friction log* |
| Feature Requests (không bắt buộc) | Dán cả mục; mỗi yêu cầu có mức ưu tiên | *Feature requests* |
| **Testing instructions** | Dán cả mục: link simulator, token giám khảo chỉ-đọc, lệnh Inspector, cách chạy local | *Testing instructions for judges* |
| **Open Source: contribution URL** | https://github.com/vansyson1308/kiotviet-mcp | *Open Source mini challenge fields* |
| Open Source: repository URL | https://github.com/vansyson1308/groceryclaw | như trên |
| Open Source: GitHub username | `vansyson1308` | như trên |
| Open Source: what / how / why | Dán ba đoạn *What we did*, *How it works*, *Why it matters* | như trên |

> Nếu tên ô trên form hơi khác bảng này, cứ tìm mục cùng nghĩa trong `DEVPOST_SUBMISSION.md`. Có thể nhờ Claude in Chrome dán giúp, nhưng **anh tự bấm Submit**.

---

## Bước 3. Kiểm tra trước khi bấm Submit (5 phút)

- [ ] Mở **link YouTube** bằng tab ẩn danh: video chạy được, đang **Public**, dài dưới 3 phút.
- [ ] Mở **link simulator** bằng tab ẩn danh: bấm "Good morning, how's the shop?" và thấy câu trả lời. Nếu thấy nhãn "Offline brain" thì vẫn chấp nhận được, nhưng báo Claude.
- [ ] Mở **2 repo** bằng tab ẩn danh: cả hai đều public và có giấy phép MIT.
- [ ] Trong form **không còn** dấu ngoặc ⟪ ⟫ nào.
- [ ] Track là **Alexa+**; mini challenge tick đúng theo tin nhắn bàn giao.
- [ ] Câu trung thực về AWS vẫn còn: *"No AWS service runs in the live demo … implemented, not deployed: AWS account unavailable"*. Không sửa thành "chạy trên AWS".
- [ ] Bấm **Submit**. Trước hạn chót vẫn quay lại sửa được.

---

## Sau khi nộp: giữ demo chạy đến 03/12

- Ban giám khảo chấm từ 09/11 đến 20/11; luật yêu cầu dự án **thử được miễn phí đến hết thời gian chấm**. Kết quả công bố khoảng 03/12.
- **Giữ nguyên trên Render:** `shopvoice`, `shopvoice-mcp`, `shopvoice-db` và cron `shopvoice-reseed`. Tổng khoảng **$22/tháng**.
- **Không đổi** `MCP_JUDGE_TOKEN`, vì token này đã in trong README và trong form.
- **Anthropic:** giữ spend limit khoảng $30 trong Console, và xem trang Usage mỗi tuần. Trong code, simulator tự giới hạn 400 lượt và $2 mỗi ngày. Quá giới hạn thì nó chuyển sang "Offline brain", không bao giờ hiện trang lỗi.
- Nếu Render báo lỗi deploy, bản deploy cũ vẫn tiếp tục chạy. Gửi Claude log của bước `preDeployCommand`.
