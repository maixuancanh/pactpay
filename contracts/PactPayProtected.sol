// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
/// @notice Separate V2 escrow: capture holds each member's funds through a dispute window.
/// @dev Fixed non-rebasing, non-fee token only. No administrator, upgrade or sweep.
contract PactPayProtected is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    uint256 public totalLiability;
    enum State { None, Funding, Captured, Cancelled }
    struct Booking { address merchant; State state; uint64 fundingDeadline; uint64 captureDeadline; uint64 window; uint64 resolutionPeriod; uint64 capturedAt; uint256 total; uint256 funded; bytes32 termsHash; address[] members; }
    struct Position { uint256 share; uint256 paid; uint256 nonce; bool disputed; bool settled; }
    mapping(bytes32 => Booking) private bookings;
    mapping(bytes32 => mapping(address => Position)) public positions;
    mapping(address => uint256) public credits;
    mapping(address => uint256) public merchantNonce;
    bytes32 public constant RESOLUTION_TYPEHASH = keccak256("Resolution(bytes32 bookingId,address member,uint256 refund,uint256 nonce,uint256 deadline)");
    event Created(bytes32 indexed bookingId, address indexed merchant, bytes32 termsHash);
    event Funded(bytes32 indexed bookingId, address indexed member, uint256 amount);
    event Captured(bytes32 indexed bookingId, uint256 complaintDeadline, uint256 resolutionDeadline);
    event Disputed(bytes32 indexed bookingId, address indexed member);
    event Settled(bytes32 indexed bookingId, address indexed member, uint256 refund, uint256 payout);
    event Claimed(address indexed recipient, uint256 amount);
    constructor(IERC20 asset) EIP712("PactPayProtected", "2") { require(address(asset) != address(0), "token"); token = asset; }
    function booking(bytes32 id) external view returns (Booking memory) { return bookings[id]; }
    function create(address[] calldata members, uint256[] calldata shares, uint64 fundingDeadline, uint64 captureDeadline, uint64 window, uint64 resolutionPeriod, bytes32 termsHash) external returns (bytes32 id) {
        require(members.length > 0 && members.length <= 5 && members.length == shares.length, "roster");
        require(fundingDeadline > block.timestamp && captureDeadline > fundingDeadline && window > 0 && resolutionPeriod > 0, "deadlines");
        // Explicit bounds prevent policies whose settlement deadlines cannot be represented.
        require(window <= 365 days && resolutionPeriod <= 365 days, "policy bounds");
        id = keccak256(abi.encode(block.chainid, address(this), msg.sender, merchantNonce[msg.sender]++));
        Booking storage b = bookings[id]; b.merchant = msg.sender; b.state = State.Funding;
        b.fundingDeadline = fundingDeadline; b.captureDeadline = captureDeadline; b.window = window; b.resolutionPeriod = resolutionPeriod; b.termsHash = termsHash;
        for (uint256 i; i < members.length; i++) { require(members[i] != address(0) && members[i] != msg.sender && shares[i] > 0 && positions[id][members[i]].share == 0, "member"); positions[id][members[i]].share = shares[i]; b.members.push(members[i]); b.total += shares[i]; }
        emit Created(id, msg.sender, termsHash);
    }
    function contribute(bytes32 id) external nonReentrant {
        Booking storage b = bookings[id]; Position storage p = positions[id][msg.sender];
        require(b.state == State.Funding && block.timestamp < b.fundingDeadline && p.share > 0 && p.paid == 0, "funding");
        p.paid = p.share; b.funded += p.share; totalLiability += p.share;
        uint256 beforeBalance = token.balanceOf(address(this)); token.safeTransferFrom(msg.sender, address(this), p.share);
        require(token.balanceOf(address(this)) - beforeBalance == p.share, "unsupported token"); emit Funded(id, msg.sender, p.share);
    }
    function capture(bytes32 id) external {
        Booking storage b = bookings[id]; require(msg.sender == b.merchant && b.state == State.Funding && b.funded == b.total && block.timestamp < b.captureDeadline, "capture");
        b.state = State.Captured; b.capturedAt = uint64(block.timestamp); emit Captured(id, block.timestamp + b.window, block.timestamp + b.window + b.resolutionPeriod);
    }
    function cancel(bytes32 id) external { Booking storage b = bookings[id]; require(msg.sender == b.merchant && b.state == State.Funding, "cancel"); b.state = State.Cancelled; }
    function dispute(bytes32 id) external {
        Booking storage b = bookings[id]; Position storage p = positions[id][msg.sender];
        require(b.state == State.Captured && block.timestamp < uint256(b.capturedAt) + b.window && p.paid > 0 && !p.settled && !p.disputed, "dispute"); p.disputed = true; emit Disputed(id, msg.sender);
    }
    function resolutionDigest(bytes32 id, address member, uint256 refund, uint256 nonce, uint256 deadline) public view returns (bytes32) { return _hashTypedDataV4(keccak256(abi.encode(RESOLUTION_TYPEHASH, id, member, refund, nonce, deadline))); }
    function resolve(bytes32 id, address member, uint256 refund, uint256 deadline, bytes calldata buyerSignature, bytes calldata merchantSignature) external nonReentrant {
        Booking storage b = bookings[id]; Position storage p = positions[id][member];
        require(b.state == State.Captured && p.disputed && !p.settled && refund <= p.paid && block.timestamp <= deadline && block.timestamp < uint256(b.capturedAt) + b.window + b.resolutionPeriod, "resolution");
        bytes32 digest = resolutionDigest(id, member, refund, p.nonce, deadline);
        require(SignatureChecker.isValidSignatureNow(member, digest, buyerSignature) && SignatureChecker.isValidSignatureNow(b.merchant, digest, merchantSignature), "signatures");
        _settle(id, member, refund);
    }
    function settle(bytes32 id, address member) external {
        Booking storage b = bookings[id]; Position storage p = positions[id][member]; require(p.paid > 0 && !p.settled, "position");
        if (b.state == State.Cancelled || (b.state == State.Funding && (block.timestamp >= b.captureDeadline || (b.funded < b.total && block.timestamp >= b.fundingDeadline)))) { _settle(id, member, p.paid); return; }
        require(b.state == State.Captured && block.timestamp >= uint256(b.capturedAt) + b.window, "window");
        if (p.disputed) { require(block.timestamp >= uint256(b.capturedAt) + b.window + b.resolutionPeriod, "resolution pending"); _settle(id, member, p.paid); }
        else _settle(id, member, 0);
    }
    function _settle(bytes32 id, address member, uint256 refund) private { Position storage p = positions[id][member]; p.settled = true; p.nonce++; credits[member] += refund; uint256 payout = p.paid - refund; credits[bookings[id].merchant] += payout; emit Settled(id, member, refund, payout); }
    function claim() external nonReentrant { uint256 amount = credits[msg.sender]; require(amount > 0, "no credit"); credits[msg.sender] = 0; totalLiability -= amount; token.safeTransfer(msg.sender, amount); emit Claimed(msg.sender, amount); }
}
