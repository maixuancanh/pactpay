// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
/// @notice Compact EOA-owned, zero-value atomic executor. NOT ERC4337.
/// @dev Raw calldata: deadline,nonce,v,r,s,target1,len1,target2,len2,data1,data2.
/// All header values occupy 32 bytes; data tails are exact, unpadded bytes.
contract PactAccountCompact {
    address public immutable owner;
    uint256 private nonce;
    constructor(){address signer;assembly{codecopy(0,sub(codesize(),32),32) signer:=mload(0)}require(signer!=address(0));owner=signer;}
    fallback() external {
        address signer=owner;
        assembly {
            // No payable entry point, exact data bounds, max two deployed targets.
            if lt(calldatasize(),288) {revert(0,0)}
            let n:=calldataload(32)
            if or(iszero(eq(n,sload(0))),gt(timestamp(),calldataload(0))) {revert(0,0)}
            let a:=calldataload(160)
            let b:=calldataload(224)
            let al:=calldataload(192)
            let bl:=calldataload(256)
            if lt(al,4) {revert(0,0)}
            if or(gt(calldatasize(),33056),iszero(eq(calldatasize(),add(288,add(al,bl))))) {revert(0,0)}
            if or(or(iszero(extcodesize(a)),eq(a,address())),and(iszero(iszero(bl)),or(or(lt(bl,4),iszero(extcodesize(b))),eq(b,address())))) {revert(0,0)}
            if and(iszero(bl),iszero(iszero(b))) {revert(0,0)}
            // EIP712 domain and AtomicPayment struct constants inserted by compiler.
            mstore(0,0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218)
        }
        bytes32 typeHash=keccak256("AtomicPayment(bytes32 dataHash,address relayer,uint256 nonce,uint256 deadline)");
        assembly {
            mstore(32,chainid()) mstore(64,address())
            let domain:=keccak256(0,96)
            calldatacopy(192,160,sub(calldatasize(),160))
            let dataHash:=keccak256(192,sub(calldatasize(),160))
            mstore(0,typeHash) mstore(32,dataHash) mstore(64,caller()) mstore(96,calldataload(32)) mstore(128,calldataload(0))
            let message:=keccak256(0,160)
            mstore(0,shl(240,0x1901)) mstore(2,domain) mstore(34,message)
            let digest:=keccak256(0,66)
            let v:=calldataload(64)
            if or(iszero(or(eq(v,27),eq(v,28))),gt(calldataload(128),0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0)) {revert(0,0)}
            mstore(0,digest) mstore(32,v) mstore(64,calldataload(96)) mstore(96,calldataload(128)) mstore(128,0)
            if iszero(staticcall(gas(),1,0,128,128,32)) {revert(0,0)}
            if iszero(eq(mload(128),signer)) {revert(0,0)}
            sstore(0,add(sload(0),1))
            let al:=calldataload(192)
            let bl:=calldataload(256)
            calldatacopy(0,288,al)
            if iszero(call(gas(),calldataload(160),0,0,al,0,0)) {returndatacopy(0,0,returndatasize()) revert(0,returndatasize())}
            if bl {
                calldatacopy(0,add(288,al),bl)
                if iszero(call(gas(),calldataload(224),0,0,bl,0,0)) {returndatacopy(0,0,returndatasize()) revert(0,returndatasize())}
            }
        }
    }
}
