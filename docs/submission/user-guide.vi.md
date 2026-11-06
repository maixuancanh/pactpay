# Hướng dẫn PactPay

PactPay thu tiền theo một thỏa thuận chung giữa người bán và 1–5 thành viên. Mỗi
người có phần đóng góp cố định. Token dUSD chỉ dùng để thử nghiệm, không có giá trị
hay tài sản bảo chứng. Bản web hiện chưa có hợp đồng PactPay được triển khai trên V3.

## Bắt đầu

Mở https://pactpay-portaldot-2026.vercel.app/native. Kết nối Polkadot.js Extension
và chọn đúng tài khoản. Chỉ chia sẻ địa chỉ công khai; không nhập seed phrase/private
key vào PactPay. Phí giao dịch và khoản đặt cọc lưu trữ sử dụng token native tPOT,
tách biệt với dUSD dùng trong thỏa thuận.

Khi có deployment đã xác minh, nhập cấu hình hoặc link/file thỏa thuận. Mở link
chỉ hiện bản xem trước. Kiểm tra người bán, nội dung, thành viên, số tiền và hai hạn
chót; bấm **Verify and import** để đối chiếu hợp đồng và dữ liệu trên chain trước khi lưu.

## Người bán

1. Vào **Create agreement**, nhập tên, nội dung và tên người bán.
2. Chọn 1–5 thành viên và số dUSD từng người. Địa chỉ native phải có mapping đã
   được runtime xác minh trước khi tạo giao dịch.
3. Đặt thời gian góp tiền và thời gian thu tiền. Bản nháp tự lưu trong trình duyệt;
   **Clear draft** xóa bản nháp, không xóa thỏa thuận đã tạo.
4. Xem lại toàn bộ điều khoản cùng phí/đặt cọc, rồi tự xác nhận trong extension.
5. Sau khi giao dịch được xác nhận và đọc lại thành công, chia sẻ link/file thỏa thuận.
6. Khi mọi phần góp đã đủ, bấm **Capture collection** trước hạn. Capture tạo quyền
   nhận tiền cho người bán; **Claim** mới chuyển token về ví.

## Thành viên

Nhập và kiểm tra thỏa thuận. **Approve exact share** chỉ cấp quyền sử dụng token;
**Contribute** mới góp tiền. Kiểm tra số tiền và hợp đồng trong từng lần xem lại.
Khi vẫn đang Funding và còn hạn, người đã góp có thể rút toàn bộ phần góp của mình.
Khi đủ phần của tất cả thành viên, trạng thái chuyển sang Ready.

Nếu người bán hủy hoặc thỏa thuận hết hạn, cần xử lý expiry khi ứng dụng yêu cầu,
sau đó mỗi người tự **Claim** phần được hoàn. Thời gian trôi qua không tự chuyển
token vào ví. Claim của người này không lấy mất credit của người khác.

## Khôi phục và sao lưu

Nếu ví mất phản hồi, không ký lại ngay. Dùng **Check transaction** để đối soát dữ
liệu đã lưu với lịch sử finalized. Giao dịch chưa rõ kết quả vẫn bị chặn để tránh
gửi trùng. Nếu quá cửa sổ tìm kiếm gần đây, kiểm tra lịch sử ví/chain; không xóa
dữ liệu trình duyệt để bỏ qua cảnh báo.

**Download workspace backup** lưu cấu hình và các thỏa thuận; không chứa khóa,
quyền ví hay yêu cầu ký đang chờ. Backup không thay thế dữ liệu khôi phục giao dịch
chưa rõ kết quả. Khôi phục kiểm tra toàn bộ dữ liệu trước khi thay workspace; đang
có giao dịch chờ thì không cho khôi phục. Link/file chứa điều khoản công khai:
người nhận link có thể đọc nội dung.

Nếu chain hoặc dữ liệu đọc bị cũ/lỗi, các thao tác thanh toán bị tạm dừng. Dùng
**Refresh agreement** khi kết nối ổn định. Chỉ mở một yêu cầu ký; khóa cùng origin
giúp tránh hai tab PactPay cùng ký. Các origin hoặc ứng dụng ví khác không dùng
chung khóa này.
