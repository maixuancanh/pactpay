// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "./DemoUSD.sol";
/// @dev Test-only callback token, never deployed by the app.
contract ReentrantToken is DemoUSD {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackBlocked;
    function arm(address target, bytes calldata data) external onlyOwner {
        callbackTarget = target;
        callbackData = data;
        callbackBlocked = false;
    }
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from == callbackTarget && callbackTarget != address(0)) {
            (bool ok, ) = callbackTarget.call(callbackData);
            callbackBlocked = !ok;
        }
        super._update(from, to, amount);
    }
}
