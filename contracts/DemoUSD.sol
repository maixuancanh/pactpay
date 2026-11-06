// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
/// @notice Test-only asset: no backing, no production value. Owner can pause for failure drills.
contract DemoUSD is ERC20, Ownable {
    bool public transfersPaused;
    constructor() ERC20("PactPay Demo Dollar", "dUSD") Ownable(msg.sender) {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    function setTransfersPaused(bool value) external onlyOwner {
        transfersPaused = value;
    }
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        require(!transfersPaused, "Test transfers paused");
        super._update(from, to, amount);
    }
}
