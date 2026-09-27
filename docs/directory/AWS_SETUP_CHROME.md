# Hướng dẫn AWS cho Claude in Chrome (bước cuối trước khi nộp)

Tài liệu này dành cho anh Sơn và cho **Claude in Chrome** làm thay anh trên AWS Console. Tên nút và menu giữ nguyên tiếng Anh cho khớp với màn hình.

**Mục tiêu:** có một access key AWS **hợp lệ** trong môi trường Claude Code. Khi có key, Claude Code tự chạy phần còn lại:
- deploy;
- tạo tài khoản reviewer;
- smoke test và lấy evidence;
- đẩy plugin repo;
- điền host vào `SUBMISSION_KIT.md`.

Domain: **dùng domain CloudFront** (`dxxxx.cloudfront.net`). Không cần mua domain, không có bước DNS nào.

**Thời gian:** khoảng 15 phút cho phần AWS Console, 20–30 phút cho Claude Code deploy.
**Chi phí:** khoảng $20/tháng (EC2 t3.small, CloudFront, S3, CloudWatch), trừ vào credit. Tắt bằng `scripts/aws/teardown.sh`.

**Vì sao lần trước không chạy:** AWS trả về `InvalidClientTokenId` cho key hiện có trong môi trường Claude Code. Key đó đã bị xóa, bị vô hiệu, hoặc bị copy thiếu ký tự. Vì vậy cần tạo key mới và **thay** key cũ.

---

## Quy tắc cho Claude in Chrome (dán nguyên đoạn này làm lời dặn đầu tiên)

```text
Bạn đang giúp anh Sơn cấu hình AWS cho dự án ShopVoice theo file AWS_SETUP_CHROME.md. Quy tắc:
1. Chỉ làm đúng các bước trong hướng dẫn. Region luôn là us-east-1 (N. Virginia).
2. KHÔNG xóa, dừng hay sửa bất kỳ tài nguyên AWS nào đã có sẵn (EC2, S3, IAM user khác, stack CloudFormation...).
3. KHÔNG bật dịch vụ trả phí, không mua gói Support, không mua domain, không đổi phương thức thanh toán.
4. KHÔNG chép Secret access key vào khung chat hay vào bất kỳ đâu ngoài ô cấu hình môi trường Claude Code ở Phần 5. Không chụp màn hình trang có secret.
5. Gặp màn hình MFA, đăng nhập, thanh toán, hoặc điều gì không có trong hướng dẫn: DỪNG và hỏi anh Sơn.
6. Cuối cùng, báo lại: Account ID (12 số), tên IAM user, Access key ID (chỉ phần AKIA..., KHÔNG có secret), budget đã tạo chưa, Bedrock đã bật chưa.
```

---

## Phần 1: Đăng nhập và kiểm tra (2 phút)

1. Mở https://console.aws.amazon.com/ và đăng nhập (anh tự nhập mật khẩu và MFA).
2. Góc trên bên phải, chọn region **US East (N. Virginia) us-east-1**.
3. Góc trên bên phải, bấm tên tài khoản → ghi lại **Account ID** (12 số).
4. Vào **Billing and Cost Management → Credits** (https://console.aws.amazon.com/billing/home#/credits). Xem credit còn bao nhiêu và hạn dùng. Chỉ đọc, không bấm gì thêm.

## Phần 2: Budget báo động $40 (3 phút)

Mục đích: nếu chi phí vượt ngưỡng, anh nhận email ngay.

1. Vào **Billing and Cost Management → Budgets → Create budget** (https://console.aws.amazon.com/billing/home#/budgets).
2. Chọn **Use a template (simplified)** → **Monthly cost budget**.
3. Điền:
   - **Budget name:** `shopvoice-40usd`
   - **Enter your budgeted amount:** `40`
   - **Email recipients:** `sonnv.hd34@gmail.com`
4. Bấm **Create budget**.

Budget miễn phí (2 budget đầu tiên). Nếu đã có budget tên `shopvoice-40usd`, bỏ qua phần này.

## Phần 3: Tạo IAM user và access key (5 phút)

1. Vào **IAM → Users** (https://console.aws.amazon.com/iam/home#/users).
2. Kiểm tra đã có user `shopvoice-deploy` chưa:
   - **Chưa có:** bấm **Create user**.
     - **User name:** `shopvoice-deploy`.
     - **KHÔNG** tick "Provide user access to the AWS Management Console". Bấm **Next**.
     - **Permissions options:** chọn **Attach policies directly**, tìm và tick **AdministratorAccess**. Bấm **Next** → **Create user**.

     (Tài khoản chỉ dùng cho hackathon nên AdministratorAccess là đơn giản nhất. Sau cuộc thi, xóa access key ở bước dọn dẹp.)
   - **Đã có:** bấm vào user đó → tab **Permissions**. Kiểm tra có **AdministratorAccess**; nếu chưa có thì **Add permissions → Attach policies directly → AdministratorAccess**.
3. Trong user `shopvoice-deploy`, chọn tab **Security credentials**.
4. Kéo xuống **Access keys**:
   - Nếu đã có **2** key, bấm **Actions → Deactivate** trên key cũ nhất. Chỉ **Deactivate**, không Delete. IAM chỉ cho phép tối đa 2 key.
   - Bấm **Create access key**.
   - **Use case:** chọn **Command Line Interface (CLI)**, tick ô xác nhận ở cuối, bấm **Next**.
   - **Description tag:** `claude-code-shopvoice`. Bấm **Create access key**.
5. Màn hình **Retrieve access keys** chỉ hiện secret **một lần**:
   - Bấm **Download .csv file** để giữ bản dự phòng trên máy anh.
   - **Để nguyên tab này**, chuyển sang Phần 5. Đừng bấm **Done** trước khi dán xong.

## Phần 4: Bật model Bedrock cho simulator giọng nói (2 phút, cho bài Devpost)

Simulator Alexa của bài Devpost gọi **Amazon Nova 2 Lite** trên Bedrock. Connector Claude không cần bước này.

1. Vào **Amazon Bedrock** (region us-east-1) → menu trái **Model access** (https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess).
2. Nếu trang có nút **Modify model access** hoặc **Enable specific models**:
   - tick **Amazon → Nova 2 Lite** (và **Nova Lite** nếu có);
   - bấm **Next → Submit**.
   - Model của Amazon được duyệt ngay, không mất phí khi chưa dùng.
3. Nếu trang báo model đã được bật sẵn (AWS mới tự bật model serverless khi gọi lần đầu), không cần làm gì.
4. **KHÔNG** bấm "Provisioned Throughput" (tính phí theo giờ).

## Phần 5: Đưa key vào môi trường Claude Code (anh tự làm, 2 phút)

Nên để **anh tự dán** ở bước này. Nếu cho Claude in Chrome làm, nó chỉ được dán vào đúng các ô dưới đây, **không** dán vào khung chat.

1. Mở https://claude.ai/code, vào phiên ShopVoice (repo `vansyson1308/groceryclaw`).
2. Trên thanh tiêu đề phiên, bấm **menu môi trường cloud** (tên environment) → **Edit**.
3. Nếu có mục **API credentials** có AWS:
   - **sửa** credential AWS đang có (đây là key cũ, sai);
   - dán **Access key ID** và **Secret access key** mới;
   - region `us-east-1`.

   Nếu không có mục đó, sửa trong **Environment variables**. **Thay** giá trị cũ, không thêm dòng trùng:
   ```text
   AWS_ACCESS_KEY_ID=<Access key ID mới, bắt đầu bằng AKIA>
   AWS_SECRET_ACCESS_KEY=<Secret access key mới>
   AWS_REGION=us-east-1
   AWS_DEFAULT_REGION=us-east-1
   ```
   Nếu có dòng `AWS_SESSION_TOKEN`, xóa dòng đó (key IAM user không dùng session token).
4. Bấm **Save**. Quay lại tab AWS và bấm **Done**.
5. **Mở phiên Claude Code MỚI.** Môi trường chỉ được nạp khi phiên bắt đầu, phiên đang chạy không thấy key mới.
   - Repo: `vansyson1308/groceryclaw`
   - Nhánh: `feat/claude-directory`

   Dán lời nhắn ở Phần 6.

## Phần 6: Lời nhắn cho phiên Claude Code mới (dán nguyên văn)

```text
Tiếp tục SPEC 04 (ShopVoice lên Claude directory) trên nhánh feat/claude-directory, PR #27. Đọc docs/directory/STATUS.md, BLOCKERS.md và DEPLOYMENT.md trước. Anh đã thay AWS key mới vào môi trường (IAM user shopvoice-deploy, us-east-1). Domain: dùng domain CloudFront. Làm tiếp:
1. aws sts get-caller-identity để kiểm tra key (không in secret).
2. SUPPORT_EMAIL=sonnv.hd34@gmail.com ALARM_EMAIL=sonnv.hd34@gmail.com scripts/aws/deploy.sh (không dùng --show-secrets).
3. create_reviewer.mjs cho sonnv.hd34+shopvoice-reviewer@gmail.com, mật khẩu chỉ lưu SSM /shopvoice/demo/reviewer-password.
4. scripts/aws/smoke.sh, inspector_oauth_evidence.mjs --label deployed, curl -i 401 handshake, lưu evidence.
5. build_plugin.mjs --host <cloudfront host>, push lên vansyson1308/shopvoice-plugin nhánh main.
6. check_kit.mjs --host <cloudfront host>; điền bảng URL trong DEPLOYMENT.md, các link ⚠️ trong docs/hackathon/DEVPOST_SUBMISSION.md, cập nhật STATUS/BLOCKERS (đóng DB1, DB3).
7. Chạy typecheck/lint/test, quét secret, commit, push, rồi báo cho anh các URL và những gì anh cần tự làm (OWNER_CLAUDE_TEST.md, nộp portal).
Giữ nguyên các quy tắc cũ: không in/commit secret, không nói "đã deploy/đã listed" khi chưa có bằng chứng, chi phí AWS vượt ~$40 thì hỏi anh trước.
```

## Phần 7: Sau khi Claude Code báo deploy xong (anh làm)

1. Mở email **"AWS Notification - Subscription Confirmation"** và bấm **Confirm subscription**, để nhận cảnh báo khi server lỗi.
2. Làm `OWNER_CLAUDE_TEST.md`: thêm custom connector trong Claude, chạy 5 câu hỏi, điền bảng kết quả rồi gửi lại.
3. Lấy mật khẩu reviewer để dán vào portal. Hai cách:
   - AWS Console → **Systems Manager → Parameter Store** → `/shopvoice/demo/reviewer-password` → **Show decrypted value**;
   - hoặc chạy trong AWS CloudShell: `aws ssm get-parameter --with-decryption --name /shopvoice/demo/reviewer-password --query Parameter.Value --output text`.
4. Nộp theo `SUBMISSION_KIT.md`: https://claude.ai/directory/manage → **Submit new**, connector trước, plugin sau, rồi pair hai cái.

---

## Phương án B: deploy bằng AWS CloudShell (không cần access key)

Dùng khi Phần 5 không làm được, ví dụ không tìm thấy chỗ sửa credential. CloudShell chạy bằng quyền của người đang đăng nhập console. Claude in Chrome có thể gõ các lệnh này vào CloudShell.

1. AWS Console (region us-east-1), bấm biểu tượng **CloudShell** (hình `>_` trên thanh trên cùng). Đợi terminal sẵn sàng.
2. Dán từng khối lệnh:
   ```bash
   git clone https://github.com/vansyson1308/groceryclaw && cd groceryclaw
   git checkout feat/claude-directory     # hoặc main nếu PR #27 đã merge
   node -v && npm -v && openssl version   # cần Node 18 trở lên
   ```
   ```bash
   SUPPORT_EMAIL=sonnv.hd34@gmail.com ALARM_EMAIL=sonnv.hd34@gmail.com scripts/aws/deploy.sh
   ```
   Lệnh này chạy 15–25 phút. Khi xong, nó in ra `MCP endpoint : https://dxxxx.cloudfront.net/mcp`.
3. Tạo reviewer và chạy smoke (mật khẩu chỉ lưu SSM, không in ra):
   ```bash
   BASE=$(node -e "console.log(require('./infra/aws/cdk-outputs.json')['ShopVoice-demo'].PublicBaseUrlOutput)")
   node scripts/directory/create_reviewer.mjs --base-url "$BASE" \
     --email sonnv.hd34+shopvoice-reviewer@gmail.com --ssm-name /shopvoice/demo/reviewer-password
   scripts/aws/smoke.sh
   ```
4. Gửi lại cho Claude Code **chỉ** 3 thứ:
   - dòng `MCP endpoint : ...`;
   - dòng tổng kết cuối của `smoke.sh` (pass/fail);
   - nội dung file `docs/directory/evidence/oauth-smoke-deployed.json`. File này không chứa secret, nhưng Claude Code sẽ quét lại.

   **Không** gửi token, mật khẩu hay access code.

   Claude Code sẽ build và push plugin, điền host vào kit, và cập nhật tài liệu.
5. CloudShell tự xóa file sau 120 ngày không dùng. Stack AWS vẫn chạy bình thường; muốn tắt thì chạy `scripts/aws/teardown.sh` trong CloudShell.

---

## Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `InvalidClientTokenId` | Key sai, đã xóa hoặc copy thiếu | Tạo key mới (Phần 3), thay vào môi trường (Phần 5), mở phiên mới |
| `SignatureDoesNotMatch` | Secret access key bị copy sai hoặc thừa dấu cách | Dán lại secret từ file .csv |
| `AccessDenied` / `not authorized to perform` | User thiếu quyền | Gắn **AdministratorAccess** cho `shopvoice-deploy` |
| `cdk bootstrap` báo lỗi S3/ECR | Stack `CDKToolkit` cũ bị hỏng | Chụp lỗi gửi Claude Code, **không** tự xóa stack |
| Simulator báo `AccessDeniedException` từ Bedrock | Chưa bật Nova | Làm Phần 4 |
| Deploy xong nhưng `/healthz` không lên sau 15 phút | Instance vẫn đang build Docker | Claude Code đọc log CloudWatch `/shopvoice/demo`; anh không cần làm gì |

## Dọn dẹp sau cuộc thi

**Chưa làm cho tới khi directory duyệt xong:** reviewer cần server chạy trong suốt quá trình review.

1. Tắt toàn bộ: `scripts/aws/teardown.sh` (thêm `--purge-secrets` để xóa cả SSM).
2. **IAM → Users → shopvoice-deploy → Security credentials**: **Deactivate**, rồi **Delete** access key.
3. Giữ budget `shopvoice-40usd` (miễn phí).
