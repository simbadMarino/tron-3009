// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TRC3009Token is ERC20 {
    using ECDSA for bytes32;

    mapping(bytes32 => bool) public authorizationState;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    bytes32 public DOMAIN_SEPARATOR;

    constructor() ERC20("TR3009 Token", "TR3009") {
        //Configure Token name, Token Symbol and supply

        _mint(msg.sender, 1_000_000_000_000_000_000_000_000);

        uint256 chainId = getChainId();

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function getChainId() public view returns (uint256) {
        uint256 chainId = block.chainid & 0xffffffff;
        return (chainId);
    }

    //For demo purposes use the erc3009_signature_script.js helper script from this repo to generate the required arguments
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter, "Authorization not yet valid");
        require(block.timestamp < validBefore, "Authorization expired");

        bytes32 authHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, authHash)
        );

        require(!authorizationState[nonce], "Authorization already used");

        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == from, "Invalid signature");

        authorizationState[nonce] = true;

        _transfer(from, to, value);
    }
}
