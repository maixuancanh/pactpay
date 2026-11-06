# PactPay với Polkadot.js Extension

Bản host: https://pactpay-portaldot-2026.vercel.app . Bạn phải cấp quyền chia sẻ tài khoản cho domain này trong Polkadot.js riêng với localhost. Khi chain chưa cập nhật, ứng dụng vẫn chặn ký; bản host không có contract V3 sẵn để giả làm deployment thành công.

Ngày29/10 đã kiểm tra host desktop/mobile và RPC native/EVM từ chính origin của bản host. Test native hai thành viên trên local cũng pass hoàn tiền riêng/hết hạn, escrow0/liability0. Dữ liệu và chữ ký trong các test này đều là fixture local; ví thật của bạn chưa gửi giao dịch V3.

Ví sử dụng: `5DsijK7Z3ctxZPsiUnki3dMqNQApLgRFdFTPtSVp2YKyBFbt`.

Mục tiêu là ký trực tiếp bằng tài khoản native này và trả phí từ số dư native của nó. Ứng dụng không lấy seed phrase/private key và không chuyển token sang ví EVM khác để thay người ký.

## Luồng sử dụng

1. Mở `/native` trong trình duyệt đã cài Polkadot.js Extension. Cho phép PactPay đọc danh sách tài khoản và chọn đúng địa chỉ.
2. Ứng dụng đọc nhận diện V3, số dư native, mapping và quyền kiểm soát tài khoản. Tên ví hoặc địa chỉ đã nhập không thay thế chữ ký của extension.
3. Nếu cần deployment mới, xem trước lần lượt token demo và escrow. Mỗi thao tác phải dry-run, hiển thị phí/storage deposit rồi mới yêu cầu ký.
4. Người bán tạo báo giá bằng giao dịch `createQuoteNative`. Thành viên kiểm tra báo giá đã tồn tại trên chain trước khi approve/góp tiền. Tài liệu báo giá native không mang chữ ký EIP-712; file tự thân không chứng minh người bán đã chấp thuận.
5. Góp tiền, rút khi đang gom, capture, claim, hủy và xử lý hết hạn đều dùng giao dịch do ví native ký. Trạng thái hoàn tất dựa trên finality và kết quả dispatch.

## Đơn vị và quyền

- Native tPOT: runtime hiện có 14 chữ số thập phân, dùng cho phí và storage deposit.
- EVM balance view có thể dùng 18 chữ số; không áp nhầm đơn vị này vào extrinsic native.
- DemoUSD: 6 chữ số, chỉ phục vụ thử thanh toán; token này không trả phí native.
- Không đoán H160 bằng cắt chuỗi SS58. Mapping phải đọc từ runtime và kiểm tra lại.
- Không gửi `map_account` mặc định: runtime có thể bật AutoMap và vô hiệu hóa thao tác map thủ công.
- Số dư 500 tPOT được kiểm tra trước đó không phải cam kết đủ phí deployment. Cần dry-run tại thời điểm giao dịch; storage deposit có thể lớn hơn phí thực thi.

## Artifact và giới hạn bằng chứng

Contract PactPay đã thêm entrypoint native. Deployment cũ không tự cập nhật; cần deployment chứa ABI mới. Luồng EVM cũ vẫn kiểm tra chữ ký EIP-712.

Test Hardhat chứng minh quyền transaction và accounting của contract. Browser giả lập chứng minh hành vi giao diện/adapters trong phạm vi fixture. Chỉ một giao dịch có chữ ký từ extension, finalized trên V3 và được đọc lại mới chứng minh luồng native thực tế.

Các bước ký công khai chỉ thực hiện khi người dùng xem và xác nhận trong extension. Khi outcome chưa rõ sau mất kết nối, khôi phục giao dịch cũ trước; không tự động gửi lại.

## Nguồn kỹ thuật

- https://github.com/ItsCogumellum/portaldot-v3-testnet-guide
- https://github.com/ItsCogumellum/portaldot-v3-testnet-guide/blob/main/demo/04_solidity_demo.py

Runtime V3 đang chạy là nguồn quyết định cho kiểu dữ liệu, mapping, giới hạn và kết quả dry-run; ví dụ trong guide không thay thế việc kiểm tra trực tiếp.

## Kiểm chứng ngày 28/10/2026

Đợt bổ sung tiếp theo đã triển khai subscription quyền tài khoản Polkadot.js, ngắt kết nối workspace, lịch sử 50 giao dịch trên trình duyệt (copy hash/export JSON), và thu hồi allowance bằng approve0. Khi quyền thay đổi, mọi bản review đang chuẩn bị đều bị vô hiệu hóa, kể cả ngắt rồi kết nối lại cùng tài khoản. Pending và dữ liệu đã lưu vẫn được giữ để khôi phục.

Kiểm tra mới: 31 unit test và build pass. Browser native fixture kiểm chứng thêm approve/revoke/approve lại, Activity, thu hồi quyền trong khi RPC đang chuẩn bị, disconnect/reconnect và luồng tiền. Đọc V3 lúc23:48 giờ Việt Nam vẫn thấy head232115/finalized232113 và timestamp chậm hơn4giờ, dry-run trả503; chưa ký hoặc broadcast V3.

- `npm run test:contracts`: 18 test pass; `npm run test:unit`: 28 test pass; `npm run build`: pass.
- `npm run test:native:browser`: adapter native giả lập, contract thật trên Ganache local. Deploy, mint100, tạo nhóm, approve/góp10, capture/claim; ví100dUSD, escrow0 và liability0. Test cưỡng bức đọc code trả503 sau deployment, reload rồi khôi phục: token chỉ triển khai một lần.
- `npm run probe:native`: đọc V3 và dry-run, không ký/gửi. Mapping ví hiện là `0x9e9c796039a48295676265b2e2d62fb2782f56a0`, inverse mapping khớp tài khoản native. Đây là địa chỉ đại diện do runtime quản lý; không phải ví EVM khác cần nhập khóa.
- Snapshot lúc22:54 giờ Việt Nam: head232115, finalized232113, timestamp chain12:45:54UTC. Timestamp chậm hơn3giờ nên ký bị chặn. Dry-run token demo dự tính storage deposit218,2305tPOT và fee có margin khoảng0,394tPOT; đây chưa bao gồm deployment escrow và có thể thay đổi.
- Không có giao dịch V3 native thực tế trong bằng chứng. Khi mạng cập nhật trở lại, cần kết nối extension thật, xem review và ký từng bước rồi kiểm chứng finality/readback.
