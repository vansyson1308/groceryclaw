# KIRO_RUNBOOK: anh Sơn chạy Kiro để làm phần "hosted demo"

Mục tiêu: dùng **Kiro Crew** (công cụ của AWS) trên máy Windows của anh để code tính năng `hosted-demo`: bản demo chạy trên Render. Nhờ phần việc này, bài thi đủ điều kiện mini challenge **AWS Builder**. Luật cuộc thi ghi: "Kiro Crew qualifies on its own as a development tool used during the hackathon".

- Hạn mục tiêu: **15/10**. Nếu đến **16/10** vẫn chưa có PR thì em (agent) tự làm phần này và bỏ claim AWS Builder.
- **Chỉ bắt đầu khi PR [#28](https://github.com/vansyson1308/groceryclaw/pull/28) đã merge vào `main`.** Em sẽ báo anh. PR đó có Claude brain mà spec này dựa vào.
- Không cần tài khoản AWS. Đăng nhập Kiro bằng **GitHub** hoặc **Google**.
- Gói **Kiro Free** có **50 credit/tháng**; một task thường tốn hơn 1 credit. Spec đã chia nhỏ thành 6 task để vừa túi. Xem mục 7 nếu hết credit.

Mọi lệnh dưới đây chạy trong **PowerShell** (bấm Start, gõ `PowerShell`). Copy nguyên dòng rồi dán.

---

## 0. Chuẩn bị (một lần, khoảng 15 phút)

1. **Git for Windows**: tải ở https://git-scm.com/download/win, cài với lựa chọn mặc định.
2. **Node.js 22 LTS**: tải ở https://nodejs.org (chọn bản 22.x LTS, Windows Installer), cài mặc định.
3. Mở PowerShell **mới** và kiểm tra:

   ```powershell
   git --version
   node --version
   ```

   Kết quả cần là `git version 2.4x` trở lên và `v22.x.x`.

4. Cho Git biết tên và email của anh (dùng đúng email GitHub):

   ```powershell
   git config --global user.name "Nguyễn Văn Sơn"
   git config --global user.email "sonnv.hd34@gmail.com"
   ```

## 1. Cài Kiro Crew và đăng nhập

1. Vào https://kiro.dev/downloads, tìm mục **Kiro Crew**, tải bản **Windows** (file `.exe` có chữ ký) và cài.
2. Mở **Kiro Crew**. Lần đầu, app sẽ hướng dẫn cài `kiro-cli` (bấm theo) rồi đăng nhập:
   - chọn **GitHub** (hoặc **Google**);
   - trình duyệt mở ra; đăng nhập và bấm **Allow/Authorize**; nếu có mã thiết bị (device code), dán mã đó vào;
   - quay lại app; thấy màn hình chat/dashboard là xong.
3. Kiểm tra (không bắt buộc):

   ```powershell
   kiro-cli whoami
   ```

   Nếu báo chưa đăng nhập, chạy `kiro-cli login`.
4. Trong app, mở phần tài khoản/usage và ghi lại số credit còn lại (để so sánh sau).

> Nếu Kiro Crew không cài được hoặc không chạy: dùng **Kiro IDE**. Xem mục 6.

## 2. Lấy code và tạo nhánh

```powershell
cd $HOME
git clone https://github.com/vansyson1308/groceryclaw.git
cd groceryclaw
git checkout main
git pull
git checkout -b kiro/hosted-demo
npm ci
npm run build
```

`npm ci` mất vài phút. Khi `npm run build` chạy xong không báo lỗi đỏ là được.

## 3. Bật dấu "Built-with: Kiro" cho mọi commit

Lệnh này cài một git hook **chỉ trong thư mục này**. Mỗi commit (kể cả commit do Kiro Crew tạo trong worktree của nó) sẽ tự có dòng `Built-with: Kiro` ở cuối.

```powershell
node scripts/kiro/install-trailer-hook.mjs
```

Phải thấy dòng `Installed ... every commit in this clone gets "Built-with: Kiro".`

> Quan trọng: trong thư mục này **chỉ commit những gì Kiro viết**. Nếu anh muốn tự sửa gì, đừng sửa ở đây, cứ báo em. Em sửa trong commit riêng, đúng luật.

## 4. Chạy từng task với Kiro Crew

Spec nằm sẵn trong repo:

- `.kiro/steering/product.md`, `tech.md`, `structure.md`: luật dự án; Kiro tự đọc.
- `.kiro/specs/hosted-demo/requirements.md`: yêu cầu, viết theo kiểu EARS.
- `.kiro/specs/hosted-demo/design.md`: thiết kế.
- `.kiro/specs/hosted-demo/tasks.md`: **6 task**, làm theo thứ tự 1 → 6.

Với **mỗi task N** (N = 1, 2, 3, 4, 5, 6), lặp lại các bước sau.

**4.1.** Trong dashboard Kiro Crew, mở **Projects** và chọn thư mục `C:\Users\<tên anh>\groceryclaw`. Nếu app hỏi "working directory" thì chọn thư mục đó. Bấm **Compose** và dán nguyên đoạn này, thay `N` bằng số task:

```text
Implement ONLY task N of .kiro/specs/hosted-demo/tasks.md in this repository.
First read .kiro/steering/product.md, .kiro/steering/tech.md, .kiro/steering/structure.md,
.kiro/specs/hosted-demo/requirements.md and .kiro/specs/hosted-demo/design.md.
Follow the design exactly; do not start any other task.
If node_modules is missing in your working copy, run npm ci first.
Verify with: npm run build && npm run lint && npm run format:check && npm run sql:guard && node --test tests/v2/*.test.mjs
(all must pass; DB tests under tests/v2/db skip on this machine because DATABASE_URL is not set, that is expected).
When done, change "- [ ] N." to "- [x] N." in .kiro/specs/hosted-demo/tasks.md and commit with a
Conventional Commit message (for example "feat(mcp-server): read-only MCP bearer tokens").
```

Bấm **Run**. Không cần bấm "Refine into a spec", vì spec đã có sẵn.

**4.2.** Chờ Kiro chạy xong (thường 5–20 phút). Trong lúc chạy, Kiro tự làm các bước sau trên một nhánh riêng tên `kirocrew/task/<id>`:

- lập kế hoạch;
- sửa code;
- chạy test;
- cho một "reviewer" kiểm tra;
- commit.

**4.3.** 📸 **Chụp màn hình** khi task chạy xong: màn hình Task Runner, thấy các bước và kết quả test.

**4.4.** Đưa kết quả về nhánh `kiro/hosted-demo`:

```powershell
git branch --list "kirocrew/*"
```

Lệnh này liệt kê nhánh Kiro vừa tạo, ví dụ `kirocrew/task/abc123`. Thay tên nhánh vào lệnh dưới:

```powershell
git checkout kiro/hosted-demo
git merge --ff-only kirocrew/task/abc123
git log --oneline -5
```

Nếu `--ff-only` báo lỗi (nhánh không nối tiếp thẳng), chạy `git merge --no-edit kirocrew/task/abc123`.

**4.5.** Kiểm tra lại trên máy (tùy chọn nhưng nên làm):

```powershell
npm run build; npm run lint; npm run format:check; node --test tests/v2/*.test.mjs
```

Dòng cuối của test phải có `# fail 0`.

**4.6.** Kiểm tra commit có dấu Kiro:

```powershell
git log -3 --format="%h %s | %(trailers:key=Built-with,valueonly)"
```

Mỗi dòng phải kết thúc bằng `| Kiro`.

**4.7.** Đẩy lên GitHub sau mỗi task, để em xem được sớm:

```powershell
git push -u origin kiro/hosted-demo
```

Nếu một task bị lỗi mà Kiro không tự sửa được: dừng lại, chụp màn hình lỗi, gửi cho em. **Không** tự sửa tay trong thư mục này.

## 5. Mở Pull Request (sau task 6, hoặc khi dừng)

1. Mở https://github.com/vansyson1308/groceryclaw/compare/main...kiro/hosted-demo
2. Bấm **Create pull request**.
   - Title: `feat(hosted-demo): Render hosted demo package (built with Kiro Crew)`
   - Phần mô tả: dán đoạn dưới, sửa số task đã xong:

   ```text
   Built with Kiro Crew (free tier) from the spec in .kiro/specs/hosted-demo/.
   Tasks completed: 1, 2, 3, 4, 5, 6
   Credits used: <số credit đã dùng>
   Every commit carries the trailer "Built-with: Kiro".
   Screenshots: docs/hackathon/evidence/kiro/
   ```

3. Bấm **Create pull request**, rồi gửi link PR cho em. Em sẽ review, sửa lỗi bằng commit riêng (không có dấu Kiro), làm CI xanh rồi merge.

**Ảnh chụp (3–4 tấm).** Lưu vào `docs/hackathon/evidence/kiro/` với tên `01-spec.png`, `02-task-run.png`, `03-tests.png`, `04-diff.png`:

1. spec/tasks trong Kiro;
2. một task đang chạy hoặc đã xong;
3. kết quả test;
4. danh sách commit hoặc diff trên GitHub.

Cách nhanh nhất: kéo thả ảnh vào ô comment của PR trên GitHub, em sẽ tải về và đưa vào repo.

**Sau khi xong**, gỡ hook để các commit sau không bị gắn nhầm:

```powershell
node scripts/kiro/install-trailer-hook.mjs --remove
```

## 6. Phương án dự phòng: Kiro IDE (chỉ khi Crew không chạy được)

1. Tải **Kiro IDE** cho Windows ở https://kiro.dev/downloads, cài, đăng nhập bằng GitHub hoặc Google.
2. **File → Open Folder** và chọn `groceryclaw`. Phải đang ở nhánh `kiro/hosted-demo` và đã chạy mục 3 (hook).
3. Mở `.kiro/specs/hosted-demo/tasks.md`. Phía trên mỗi task có nút **Start task**. Bấm task 1, chờ xong, rồi task 2, và cứ thế.
4. IDE không tự commit. Sau mỗi task, commit bằng tay; hook vẫn tự thêm `Built-with: Kiro`:

   ```powershell
   git add -A
   git commit -m "feat(hosted-demo): task 1 read-only MCP tokens"
   git push -u origin kiro/hosted-demo
   ```

5. Vì luật ghi tên "Kiro Crew", hãy đăng câu hỏi này ở tab **Discussions** trên Devpost (hoặc hỏi ở office hours 19/10, 9:00 PT = 23:00 giờ VN):

   > Hi! For the AWS Builder mini challenge, the rules say Kiro Crew qualifies on its own as a development tool. Does using the Kiro IDE (spec-driven development with requirements/design/tasks) also qualify on its own, without calling a runtime AWS service? Our AWS account is unavailable, so Kiro is our AWS tool. Thanks!

## 7. Nếu hết credit

- Xem số credit còn lại trong app trước mỗi task. Nếu còn **dưới khoảng 8 credit**, đừng bắt đầu task mới.
- Đẩy những gì đã xong (mục 4.7) và mở PR (mục 5) với các task đã xong. Em sẽ làm nốt các task còn lại, và chỉ ghi "built with Kiro" cho phần Kiro thật sự làm.
- Muốn làm tiếp bằng Kiro thì phải nâng lên gói **Pro ($20/tháng)**. Lần nâng cấp đầu được tặng $20 credit, tính theo số ngày còn lại trong tháng. **Đây là quyết định của anh**, vì là tiền của anh. Em không tự quyết.

## 8. Ghi lại khó khăn (friction log)

Gặp chỗ nào khó, lỗi hay tài liệu khó hiểu, hãy ghi ngắn vào tin nhắn cho em, theo mẫu:

```text
Việc đang làm:
Các bước đã làm:
Mong đợi:
Thực tế:
Mức độ (thấp/vừa/cao):
Cách vượt qua:
Đề xuất cho Kiro:
```

Mỗi mục có thật giúp bài thi được cộng tới 10% điểm thưởng. Em chỉ ghi những gì anh thật sự gặp.
