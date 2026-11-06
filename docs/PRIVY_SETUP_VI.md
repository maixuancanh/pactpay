# Tạo project Privy cho PactPay

Ngày kiểm tra nguồn: 03/11/2026. Đây là cấu hình Google và ví nhúng; không tự bật sponsorship, batching hoặc chứng minh V3 write.

1. Mở https://dashboard.privy.io và đăng ký/đăng nhập.
2. Chọn **Create App**, tên **PactPay**. Nếu được hỏi use case, chọn ví cho người dùng ứng dụng; không cần tạo agent signer.
3. Trong cấu hình đăng nhập của app, bật **Google**. Luồng chính của PactPay chỉ hiển thị Google; không cần bật mọi phương thức.
4. Trong cấu hình ví nhúng, bật Ethereum/EVM embedded wallet. Code PactPay cấu hình tự tạo cho người chưa có ví; người quay lại dùng ví hiện có.
5. Thêm exact origin của app vào allowed domains/origins: `http://127.0.0.1:5173` khi thử local và `https://pactpay-portaldot-2026.vercel.app` khi phát hành. Origin không có `/booking`. Nếu thử bằng localhost thì thêm riêng `http://localhost:5173`.
6. Mở **Configuration → App settings → Basics** để lấy **App ID**. App ID là định danh public, có thể gửi để cấu hình.
7. **App Secret** chỉ đặt trong môi trường server. Không gửi trong chat, không thêm vào frontend hoặc biến `VITE_*`. Cần cả ID và Secret ở server để kiểm chứng session và lấy canonical wallet từ provider.
8. Kiểm tra recovery/MFA phù hợp trong dashboard; nghiệm thu login lại và thiết bị khác phải khôi phục đúng wallet ID trước khi sử dụng tiền.

Backend đọc các biến sau từ process environment:

```dotenv
PRIVY_APP_ID=<public-app-id>
PRIVY_APP_SECRET=<server-only-secret>
APP_ORIGIN=http://127.0.0.1:5173
CHAIN_ID=420420777
```

Local `npm run dev:server` tự đọc `server/.env` bằng Node24. File này đã được bỏ khỏi source archive và Git ignore. App ID `cmvzypkdi03cw0hicngl3zksn` đã cấu hình; nhập Secret trực tiếp vào dòng `PRIVY_APP_SECRET=` trong file bằng editor riêng. Production dùng bảng Environment của dịch vụ hosting. Khi thử local chạy `npm run dev:server` và `npm run dev` từ project root ở hai terminal. Không copy secret vào lệnh dùng chung/log.

Hosted production còn cần API/PostgreSQL/worker và rewrite API như `GOOGLE_GROUP_COMMERCE_RUNBOOK.md`; chỉ cấu hình Privy trên Vercel frontend sẽ chưa có API xác thực server. Không đổi App ID sau khi người dùng đã tạo ví mà không có kế hoạch chuyển đổi rõ ràng.

Sau khi cấu hình: thử Google login → ví tạo/khôi phục → server xác minh canonical binding → logout/login lại → thử thiết bị thứ hai. Thanh toán giữ khóa nếu chưa có cấu hình execution được chứng minh trên V3. Không thêm server signer/quyền chi tự động để bỏ qua chữ ký của người dùng.

Nguồn chính thức: [Privy setup](https://github.com/privy-io/privy-agentic-wallets-skill/blob/main/references/setup.md), [Privy onboarding](https://www.privy.io/onboarding), [Privy secure settings](https://privy.io/blog/setting-a-secure-foundation). Tên vị trí từng mục dashboard có thể thay đổi; dùng đúng nhóm App settings, Login methods, Embedded wallets và Allowed domains đang hiển thị.
