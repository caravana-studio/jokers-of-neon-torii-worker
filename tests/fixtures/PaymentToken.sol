// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Local integration fixture: transfers use the standard ERC-20 event and atomic units.
contract PaymentToken {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    constructor(uint8 units) { decimals = units; balanceOf[msg.sender] = 1000 * 10 ** units; }
    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }
}
