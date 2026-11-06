// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "./PactPay.sol";

/// @notice Native Revive build: merchant authority comes from the signed native call.
/// @dev Same escrow core and digest; no redundant Ethereum signature decoder.
/// Not a substitute for the full EVM build when using createQuote(signature).
contract PactPayNative is PactPayCore {
    constructor(address fixedToken) PactPayCore(fixedToken) {}
}
