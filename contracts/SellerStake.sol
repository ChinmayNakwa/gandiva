// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Subset of Circle's FiatToken v2.2 (USDC) used here.
interface IUSDC {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transfer(address to, uint256 value) external returns (bool);
}

/// Sellers lock USDC as a bond behind their listings. If a seller is paid and returns output that breaks its own published
/// schema, the arbiter (the Gandiva registry) slashes the bond and refunds the buyer. Sellers never need gas: staking uses
/// USDC's EIP-3009 receiveWithAuthorization and unstaking an EIP-712 signature, both relayed by anyone.
contract SellerStake {
    IUSDC public immutable usdc;
    address public immutable arbiter;
    /// Delay between asking to unstake and being able to withdraw, so a seller cannot pull its bond ahead of a slash.
    uint256 public immutable cooldown;
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant UNSTAKE_TYPEHASH = keccak256("Unstake(address seller,uint256 nonce,uint256 deadline)");
    // Lower half of the secp256k1 order: rejects malleable signatures.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    mapping(address => uint256) public stakeOf;
    /// 0 = not unstaking; otherwise the time after which withdraw() releases the bond.
    mapping(address => uint256) public unlockAt;
    mapping(address => uint256) public nonces;
    uint256 public totalStaked;

    event Staked(address indexed seller, uint256 amount, uint256 total);
    event UnstakeRequested(address indexed seller, uint256 unlockAt);
    event Withdrawn(address indexed seller, uint256 amount);
    event Slashed(address indexed seller, address indexed to, uint256 amount, bytes32 evidence);

    constructor(IUSDC usdc_, address arbiter_, uint256 cooldown_) {
        require(arbiter_ != address(0), "arbiter required");
        usdc = usdc_;
        arbiter = arbiter_;
        cooldown = cooldown_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Gandiva SellerStake"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// Pulls `value` USDC from `seller` with its signed ReceiveWithAuthorization (to = this contract). Staking again cancels a pending unstake.
    function stakeWithAuthorization(
        address seller,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(value > 0, "zero stake");
        usdc.receiveWithAuthorization(seller, address(this), value, validAfter, validBefore, nonce, v, r, s);
        stakeOf[seller] += value;
        totalStaked += value;
        unlockAt[seller] = 0;
        emit Staked(seller, value, stakeOf[seller]);
    }

    /// Starts the cooldown with the seller's EIP-712 Unstake signature (relayed by anyone).
    function requestUnstakeWithSig(address seller, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "signature expired");
        require(uint256(s) <= HALF_N, "bad signature");
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(UNSTAKE_TYPEHASH, seller, nonces[seller]++, deadline)))
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == seller, "bad signature");
        _requestUnstake(seller);
    }

    function requestUnstake() external {
        _requestUnstake(msg.sender);
    }

    function _requestUnstake(address seller) private {
        require(stakeOf[seller] > 0, "nothing staked");
        unlockAt[seller] = block.timestamp + cooldown;
        emit UnstakeRequested(seller, unlockAt[seller]);
    }

    /// Anyone may trigger it once the cooldown is over; the bond only ever goes back to the seller.
    function withdraw(address seller) external {
        uint256 t = unlockAt[seller];
        require(t != 0 && block.timestamp >= t, "still locked");
        uint256 amount = stakeOf[seller];
        stakeOf[seller] = 0;
        unlockAt[seller] = 0;
        totalStaked -= amount;
        require(usdc.transfer(seller, amount), "transfer failed");
        emit Withdrawn(seller, amount);
    }

    /// Refunds `to` (the harmed buyer) from the seller's bond, up to what is staked. `evidence` identifies the rejected call.
    function slash(address seller, address to, uint256 amount, bytes32 evidence) external returns (uint256 slashed) {
        require(msg.sender == arbiter, "only arbiter");
        uint256 staked = stakeOf[seller];
        slashed = amount < staked ? amount : staked;
        require(slashed > 0, "nothing to slash");
        stakeOf[seller] = staked - slashed;
        totalStaked -= slashed;
        require(usdc.transfer(to, slashed), "transfer failed");
        emit Slashed(seller, to, slashed, evidence);
    }
}
