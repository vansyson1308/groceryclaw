# Kiểm thử ShopVoice trong Claude (anh Sơn tự làm, khoảng 20 phút)

Tài liệu này dành cho anh Sơn. Các thao tác trong ứng dụng Claude giữ nguyên tên tiếng Anh để anh bấm đúng nút.
Bước này là bắt buộc trước khi nộp: portal có một ô **Test & launch** yêu cầu xác nhận "đã chạy mọi tool như một custom connector trong Claude".

**Trước khi bắt đầu:** ShopVoice phải đã deploy (xem `DEPLOYMENT.md`). Anh cần hai thứ:
- `BASE`: địa chỉ public, ví dụ `https://d123abc.cloudfront.net` hoặc domain riêng.
- Mật khẩu reviewer. Lấy bằng lệnh `aws ssm get-parameter --with-decryption --name /shopvoice/demo/reviewer-password --query Parameter.Value --output text`. Email reviewer ghi trong `SUBMISSION_KIT.md`.

Ghi kết quả vào bảng ở cuối file rồi báo lại em. Em sẽ đánh dấu **owner-verified** chỉ sau khi anh xác nhận.

---

## A. Kiểm tra nhanh bằng trình duyệt (2 phút)

1. Mở `BASE/docs`, `BASE/privacy`, `BASE/terms` và `BASE/support`. Cả bốn trang phải hiện đầy đủ, có logo, và nút **Tiếng Việt** chuyển được ngôn ngữ.
2. Mở `BASE/.well-known/oauth-protected-resource/mcp`. Trang phải hiện JSON, trong đó có `"resource": "BASE/mcp"`.

## B. Thêm custom connector trên claude.ai (gói Pro/Max)

1. Vào **https://claude.ai/customize/connectors** (menu **Customize → Connectors**).
2. Bấm **Add custom connector**.
3. Điền:
   - **Name:** `ShopVoice`
   - **URL / MCP server URL:** `BASE/mcp` (ví dụ `https://d123abc.cloudfront.net/mcp`)
   - Nếu hộp thoại hỏi **Authentication**, chọn **Sign in now**.
   - Nếu hỏi **OAuth client**, chọn **Use Claude's published identity**. Đây là cách CIMD, được khuyến nghị. Nếu lỗi, xóa connector, thêm lại và chọn **Register automatically** (DCR), rồi ghi lại chuyện này.
   - Để trống Client ID/Secret và Request headers.
4. Bấm **Add**, rồi **Connect**. Một cửa sổ ShopVoice bật ra (nếu không thấy, hãy cho phép popup).
5. Trong cửa sổ đó:
   - **Sign in** bằng email và mật khẩu reviewer. Hoặc **Create account** bằng email của anh, khi đó anh sẽ có một cửa hàng mẫu riêng.
   - Màn hình **Allow access to your shop?** phải hiện: App là "Claude" (hoặc claude.ai), địa chỉ chuyển về là `claude.ai`, Shop là "Demo shop (sample data)".
   - Giữ tick ô "Create and confirm purchase-order drafts", rồi bấm **Allow**.
6. Quay lại Claude. Connector phải hiện **Connected**. Mở connector và xem mục **Tool permissions**: phải có đủ 9 tool.

## C. Chạy 5 câu hỏi (mở chat mới, bấm **+ → Connectors** và bật ShopVoice)

Dán lần lượt từng câu. Kết quả đúng được mô tả trong `REVIEWER_WALKTHROUGH.md`.

1. `Give me my shop briefing for today.`
   Phải có doanh số hôm qua kèm % so với cùng thứ tuần trước, **4** mặt hàng sắp hết (gấp nhất là White Sandwich Bread), và **2** hóa đơn chưa đồng bộ.
2. `What's running low in my shop?`
   Phải ra bảng 4 mặt hàng: Bread, Fresh Milk 1L, Chicken Eggs, Cola.
3. `How were sales yesterday compared to the same day last week? And what were my top 5 products by revenue over the last 7 days?`
4. `Did the Sunrise Beverages invoice arrive? Has it been synced?`
   Phải ra hóa đơn **SRB-10442**: đã về, đã khớp sản phẩm, chưa đồng bộ.
5. `Reorder milk and eggs from the dairy supplier.`
   Claude phải tạo đơn nháp (Fresh Milk 1L 120, Eggs 90, khoảng $210) và **hỏi lại anh**. Anh gõ `Yes, confirm it.`
   Claude phải hiện hộp **xin phép** trước khi chạy `confirm_reorder`. Bấm **Allow once**. Kết quả phải là "Confirmed 1 purchase order… no payment was made".

## D. Kiểm tra thêm (tùy chọn nhưng nên làm)

- **Chỉ đọc:**
  1. **Customize → Connectors → ShopVoice → Disconnect**, rồi **Connect** lại.
  2. Lần này **bỏ tick** "Create and confirm purchase-order drafts".
  3. Hỏi câu 5. ShopVoice phải báo thiếu quyền, và Claude phải đề nghị kết nối lại.
- **Trang tài khoản:** mở `BASE/account`. Phải thấy **Claude** trong **Connected apps**. Bấm **Revoke**, quay lại Claude và hỏi câu 1: Claude phải yêu cầu đăng nhập lại.
- **Tiếng Việt:** hỏi `Hàng gì sắp hết? Trả lời bằng tiếng Việt.`

## E. Plugin (Customize → Plugins → Upload plugin)

1. Tạo file zip:
   - `node scripts/directory/build_plugin.mjs --host <host của BASE>`, cho ra `dist/shopvoice-plugin.zip`;
   - hoặc lấy file zip em gửi.
2. Vào **Customize → Plugins → Add → Upload plugin** và chọn file zip.
3. Mở chat mới và hỏi `Which skills do you have from plugins?`. Phải có 4 skill: shop-morning-briefing, restock-planner, sales-insights, supplier-invoices.
4. Trong plugin, tab **Connectors** phải hiện ShopVoice (cùng URL `BASE/mcp`). Bấm **Connect** nếu chưa kết nối.
5. Hỏi `Morning! How's my shop doing?`. Claude phải trả lời theo dạng tối đa 5 gạch đầu dòng, có đề nghị bước tiếp theo.

## F. Claude Code (tùy chọn)

```bash
claude mcp add --transport http shopvoice BASE/mcp
claude            # rồi gõ /mcp → shopvoice → Authenticate → đăng nhập trên trình duyệt
```
Sau đó hỏi `What's running low in my shop?`. Màn hình chấp thuận phải hiện cảnh báo "only loopback addresses". Đây là hành vi đúng với Claude Code.

---

## Kết quả (anh điền rồi gửi lại)

| Bước | OK / Lỗi | Ghi chú (thông báo lỗi, mã `ofid_…` nếu có) |
|---|---|---|
| A. Trang public + well-known | | |
| B. Thêm connector + đăng nhập (CIMD hay DCR?) | | |
| C1 Briefing | | |
| C2 Low stock | | |
| C3 Sales + top 5 | | |
| C4 Invoice | | |
| C5 Draft → Claude xin phép → Confirm | | |
| D. Chỉ đọc / Revoke / Tiếng Việt | | |
| E. Plugin upload + skill | | |
| F. Claude Code | | |
