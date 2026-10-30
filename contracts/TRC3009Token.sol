// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/tron-contracts/access/Ownable.sol";
import {TRC20} from "@openzeppelin/tron-contracts/token/TRC20/TRC20.sol";
import {TRC3009} from "@openzeppelin/tron-contracts/token/TRC20/extensions/draft-TRC3009.sol";
import {TIP712} from "@openzeppelin/tron-contracts/utils/cryptography/TIP712.sol";

contract MyTRC3009Token is TRC20, TRC3009, Ownable {
    constructor()
        //address initialOwner
        TRC20("My3009Token", "TKN3009") //Adjust tokenName and token symbol as needed
        TIP712("My3009Token", "1") // TIP712 TokenName param must match with TRC20 named param, Version must be "1" unless there is a new future version
        Ownable(msg.sender)
    {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
