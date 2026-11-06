// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/// @notice EOA-owner-authorized atomic execution, with the submitting relayer paying native gas.
/// @dev Not ERC4337. No administrator, recovery operator, upgrade or delegate signer.
contract PactAccount {
    bool private executing;
    address public immutable owner;
    uint256 public nonce;
    struct Call { address target; bytes data; }
    bytes32 public constant CALL_TYPEHASH=keccak256("Call(address target,bytes data)");
    bytes32 public constant EXECUTE_TYPEHASH=keccak256("Execute(bytes32 callsHash,address relayer,uint256 nonce,uint256 deadline)");
    event Executed(uint256 indexed nonce,address indexed relayer,bytes32 callsHash);
    constructor(address signer) {require(signer!=address(0),"owner");owner=signer;}
    function callsHash(Call[] calldata calls) public pure returns(bytes32){bytes32[] memory hashes=new bytes32[](calls.length);for(uint256 i;i<calls.length;i++)hashes[i]=keccak256(abi.encode(CALL_TYPEHASH,calls[i].target,keccak256(calls[i].data)));return keccak256(abi.encodePacked(hashes));}
    function digest(Call[] calldata calls,address relayer,uint256 n,uint256 deadline) public view returns(bytes32){return keccak256(abi.encodePacked(hex"1901",keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("PactPayAccount"),keccak256("1"),block.chainid,address(this))),keccak256(abi.encode(EXECUTE_TYPEHASH,callsHash(calls),relayer,n,deadline))));}
    function execute(Call[] calldata calls,address relayer,uint256 n,uint256 deadline,bytes calldata signature) external {
        require(!executing,"reentrant");executing=true;
        require(msg.sender==relayer&&relayer!=address(0),"relayer");require(n==nonce&&block.timestamp<=deadline,"nonce/expiry");require(calls.length>0&&calls.length<=2,"calls");
        (address recovered,ECDSA.RecoverError error,)=ECDSA.tryRecover(digest(calls,relayer,n,deadline),signature);require(error==ECDSA.RecoverError.NoError&&recovered==owner,"signature");nonce++;
        for(uint256 i;i<calls.length;i++){require(calls[i].target!=address(this)&&calls[i].target.code.length>0,"target");(bool ok,bytes memory result)=calls[i].target.call(calls[i].data);if(!ok)assembly{revert(add(result,32),mload(result))}}
        executing=false;emit Executed(n,relayer,callsHash(calls));
    }
}
