// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
/// @dev Local test harness only. Not a production smart wallet or deployment candidate.
contract AtomicWalletHarness {
    address public immutable owner = msg.sender;
    function execute(address[] calldata targets, bytes[] calldata calls) external {
        require(msg.sender == owner && targets.length == calls.length, "authority");
        for (uint256 i; i < targets.length; i++) {
            (bool ok, bytes memory result) = targets[i].call(calls[i]);
            if (!ok) assembly { revert(add(result, 32), mload(result)) }
        }
    }
}
