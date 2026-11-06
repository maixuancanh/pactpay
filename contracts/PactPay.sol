// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/// @notice Fixed-share collection escrow. Merchant capture creates a credit; claim transfers funds.
/// @dev One fixed, non-rebasing/non-fee token. EIP-712 creation verifies an EOA signature;
/// native creation authenticates the merchant through the originating signed transaction.
/// No upgrade/sweep/admin withdrawal.
abstract contract PactPayCore is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum State {
        None,
        Funding,
        Ready,
        Captured,
        Cancelled,
        Expired
    }
    struct Quote {
        address merchant;
        address token;
        uint256 nonce;
        bytes32 termsHash;
        bytes32 membersHash;
        bytes32 sharesHash;
        uint256 total;
        uint64 fundingDeadline;
        uint64 captureDeadline;
    }
    struct Collection {
        // Fixed token is reconstructed on reads; pack deadlines with merchant/state.
        address merchant;
        uint64 fundingDeadline;
        uint64 captureDeadline;
        State state;
        uint256 nonce;
        bytes32 termsHash;
        bytes32 membersHash;
        bytes32 sharesHash;
        uint256 total;
        uint256 held;
        address[] members;
    }
    bytes32 private constant TYPEHASH =
        keccak256(
            "Quote(address merchant,address token,uint256 nonce,bytes32 termsHash,bytes32 membersHash,bytes32 sharesHash,uint256 total,uint64 fundingDeadline,uint64 captureDeadline)"
        );
    IERC20 public immutable token;
    uint256 public constant MAX_TERMS_BYTES = 16000;
    uint256 public totalLiability;
    mapping(bytes32 => Collection) private collections;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(bytes32 => mapping(address => uint256)) public shares;
    mapping(bytes32 => mapping(address => uint256)) public contributions;
    mapping(bytes32 => mapping(address => uint256)) public credits;
    error InvalidQuote();
    error Unauthorized();
    error NonceUsed();
    error BadSignature();
    error BadState();
    error Deadline();
    error TermsMismatch();
    error NotMember();
    error AlreadyContributed();
    error NothingToClaim();
    error NoContribution();
    event QuoteCreated(
        bytes32 indexed quoteId,
        address indexed merchant,
        bytes32 termsHash,
        uint256 total,
        uint64 fundingDeadline,
        uint64 captureDeadline
    );
    event Contributed(
        bytes32 indexed quoteId,
        address indexed member,
        uint256 amount
    );
    /// @notice Permanent public original terms, authenticated by the quote merchant.
    event TermsPublished(bytes32 indexed quoteId, string terms);
    event Withdrawn(
        bytes32 indexed quoteId,
        address indexed member,
        uint256 amount
    );
    event StateChanged(bytes32 indexed quoteId, State state);
    event Claimed(
        bytes32 indexed quoteId,
        address indexed recipient,
        uint256 amount
    );
    constructor(address fixedToken) {
        if (fixedToken == address(0) || fixedToken.code.length == 0)
            revert InvalidQuote();
        token = IERC20(fixedToken);
    }
    /// @dev Fixed application domain, rebuilt with current chain ID to prevent fork replay.
    function _hashTypedDataV4(bytes32 structHash) private view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("PactPay"), keccak256("1"), block.chainid, address(this)
        ));
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
    }
    function quoteDigest(Quote calldata q) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        q.merchant,
                        q.token,
                        q.nonce,
                        q.termsHash,
                        q.membersHash,
                        q.sharesHash,
                        q.total,
                        q.fundingDeadline,
                        q.captureDeadline
                    )
                )
            );
    }
    /// @notice Create a quote using the transaction's merchant authority, without an EIP-712 signature.
    /// @dev Native Revive callers use their runtime-mapped H160 as q.merchant. Mapping and
    /// native signature verification are performed by the runtime, never inferred in this contract.
    /// The quote is authenticated by its on-chain creation; an unsigned off-chain draft is not proof.
    function createQuoteNative(
        Quote calldata q,
        address[] calldata members,
        uint256[] calldata amounts
    ) external nonReentrant returns (bytes32 id) {
        id = _validateQuote(q, members, amounts);
        _recordQuote(id, q, members, amounts);
    }
    /// @notice Create a native quote with publicly recoverable original terms.
    /// @dev Terms are immutable event data; never include confidential information.
    function createQuoteNativeWithTerms(
        Quote calldata q,
        address[] calldata members,
        uint256[] calldata amounts,
        string calldata canonicalTerms
    ) external nonReentrant returns (bytes32 id) {
        id = _validateQuote(q, members, amounts);
        uint256 size = bytes(canonicalTerms).length;
        if (size == 0 || size > MAX_TERMS_BYTES) revert InvalidQuote();
        if (keccak256(bytes(canonicalTerms)) != q.termsHash)
            revert TermsMismatch();
        _recordQuote(id, q, members, amounts);
        emit TermsPublished(id, canonicalTerms);
    }
    function _validateQuote(
        Quote calldata q,
        address[] calldata members,
        uint256[] calldata amounts
    ) internal view returns (bytes32 id) {
        if (msg.sender != q.merchant) revert Unauthorized();
        if (usedNonces[q.merchant][q.nonce]) revert NonceUsed();
        if (
            q.token != address(token) ||
            q.termsHash == bytes32(0) ||
            q.total == 0 ||
            members.length == 0 ||
            members.length > 5 ||
            members.length != amounts.length ||
            block.timestamp >= q.fundingDeadline ||
            q.fundingDeadline >= q.captureDeadline
        ) revert InvalidQuote();
        if (
            keccak256(abi.encode(members)) != q.membersHash ||
            keccak256(abi.encode(amounts)) != q.sharesHash
        ) revert InvalidQuote();
        uint256 total;
        for (uint256 i; i < members.length; i++) {
            if (members[i] == address(0) || amounts[i] == 0)
                revert InvalidQuote();
            for (uint256 j; j < i; j++)
                if (members[j] == members[i]) revert InvalidQuote();
            total += amounts[i];
        }
        if (total != q.total) revert InvalidQuote();
        id = quoteDigest(q);
    }
    function _recordQuote(
        bytes32 id,
        Quote calldata q,
        address[] calldata members,
        uint256[] calldata amounts
    ) internal {
        usedNonces[q.merchant][q.nonce] = true;
        Collection storage c = collections[id];
        c.merchant = q.merchant;
        c.fundingDeadline = q.fundingDeadline;
        c.captureDeadline = q.captureDeadline;
        c.nonce = q.nonce;
        c.termsHash = q.termsHash;
        c.membersHash = q.membersHash;
        c.sharesHash = q.sharesHash;
        c.total = q.total;
        c.state = State.Funding;
        for (uint256 i; i < members.length; i++) {
            c.members.push(members[i]);
            shares[id][members[i]] = amounts[i];
        }
        emit QuoteCreated(
            id,
            q.merchant,
            q.termsHash,
            q.total,
            q.fundingDeadline,
            q.captureDeadline
        );
        emit StateChanged(id, State.Funding);
    }
    function getQuote(
        bytes32 id
    )
        external
        view
        returns (
            Quote memory terms,
            State state,
            uint256 held,
            address[] memory members
        )
    {
        Collection storage c = collections[id];
        terms = Quote(c.merchant, c.state == State.None ? address(0) : address(token),
            c.nonce, c.termsHash, c.membersHash, c.sharesHash, c.total,
            c.fundingDeadline, c.captureDeadline);
        return (terms, c.state, c.held, c.members);
    }
    function contribute(
        bytes32 id,
        bytes32 expectedTermsHash
    ) external nonReentrant {
        Collection storage c = collections[id];
        if (c.state != State.Funding) revert BadState();
        if (block.timestamp >= c.fundingDeadline) revert Deadline();
        if (c.termsHash != expectedTermsHash) revert TermsMismatch();
        uint256 amount = shares[id][msg.sender];
        if (amount == 0) revert NotMember();
        if (contributions[id][msg.sender] != 0) revert AlreadyContributed();
        contributions[id][msg.sender] = amount;
        c.held += amount;
        totalLiability += amount;
        if (c.held == c.total) {
            c.state = State.Ready;
            emit StateChanged(id, State.Ready);
        }
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Contributed(id, msg.sender, amount);
    }
    function withdrawContribution(bytes32 id) external nonReentrant {
        Collection storage c = collections[id];
        if (c.state != State.Funding) revert BadState();
        if (block.timestamp >= c.fundingDeadline) revert Deadline();
        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert NoContribution();
        contributions[id][msg.sender] = 0;
        c.held -= amount;
        totalLiability -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(id, msg.sender, amount);
    }
    function capture(bytes32 id) external nonReentrant {
        Collection storage c = collections[id];
        if (msg.sender != c.merchant) revert Unauthorized();
        if (c.state != State.Ready) revert BadState();
        if (block.timestamp >= c.captureDeadline) revert Deadline();
        c.state = State.Captured;
        credits[id][c.merchant] += c.held;
        c.held = 0;
        emit StateChanged(id, State.Captured);
    }
    function cancel(bytes32 id) external nonReentrant {
        Collection storage c = collections[id];
        if (msg.sender != c.merchant) revert Unauthorized();
        if (c.state != State.Funding && c.state != State.Ready)
            revert BadState();
        _refund(id, c, State.Cancelled);
    }
    function expire(bytes32 id) external nonReentrant {
        Collection storage c = collections[id];
        if (c.state == State.Funding) {
            if (block.timestamp < c.fundingDeadline) revert Deadline();
        } else if (c.state == State.Ready) {
            if (block.timestamp < c.captureDeadline) revert Deadline();
        } else revert BadState();
        _refund(id, c, State.Expired);
    }
    function _refund(bytes32 id, Collection storage c, State state) private {
        c.state = state;
        c.held = 0;
        for (uint256 i; i < c.members.length; i++) {
            address m = c.members[i];
            uint256 amount = contributions[id][m];
            contributions[id][m] = 0;
            credits[id][m] += amount;
        }
        emit StateChanged(id, state);
    }
    function claim(bytes32 id) external nonReentrant {
        uint256 amount = credits[id][msg.sender];
        if (amount == 0) revert NothingToClaim();
        credits[id][msg.sender] = 0;
        totalLiability -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }
}

/// @notice Full EVM build retains the original typed-signature entrypoint.
contract PactPay is PactPayCore {
    constructor(address fixedToken) PactPayCore(fixedToken) {}
    function eip712Domain() external view returns (
        bytes1 fields, string memory name, string memory version, uint256 chainId,
        address verifyingContract, bytes32 salt, uint256[] memory extensions
    ) {
        return (hex"0f", "PactPay", "1", block.chainid, address(this), bytes32(0), new uint256[](0));
    }
    function createQuote(
        Quote calldata q,
        address[] calldata members,
        uint256[] calldata amounts,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 id) {
        id = _validateQuote(q, members, amounts);
        if (ECDSA.recover(id, signature) != q.merchant) revert BadSignature();
        _recordQuote(id, q, members, amounts);
    }
}
