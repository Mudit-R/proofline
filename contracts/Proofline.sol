// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[9] calldata signals) external view returns(bool);
}

/// @notice Immutable-model inference escrow. A new model version requires a new deployment.
contract Proofline {
    enum Status { None, Pending, Settled, Refunded }
    struct Job {address requester; uint256 commitment; uint64 deadline; uint256 reward; Status status; uint8 risk; address worker;}
    IVerifier public immutable verifier;
    uint256 public immutable modelId;
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) public jobs;
    mapping(address => uint256) public credits;
    event Requested(uint256 indexed jobId, address indexed requester, uint256 commitment, uint64 deadline, uint256 reward);
    event Settled(uint256 indexed jobId, address indexed worker, uint8 risk, uint256 reward);
    event Refunded(uint256 indexed jobId);
    event Withdrawn(address indexed account, uint256 amount);
    error InvalidJob(); error InvalidContext(); error InvalidProof(); error Expired(); error NotExpired(); error Unauthorized(); error TransferFailed();
    constructor(address verifier_, uint256 modelId_){require(verifier_.code.length > 0);verifier=IVerifier(verifier_);modelId=modelId_;}
    function request(uint256 commitment, uint64 ttl) external payable returns(uint256 id){
        require(ttl>=30 && ttl<=1 days,"TTL out of range");require(msg.value>0,"Reward required");
        require(commitment>0 && commitment<21888242871839275222246405745257275088548364400416034343698204186575808495617,"Commitment out of field");
        id=nextJobId++;jobs[id]=Job(msg.sender,commitment,uint64(block.timestamp)+ttl,msg.value,Status.Pending,0,address(0));
        emit Requested(id,msg.sender,commitment,uint64(block.timestamp)+ttl,msg.value);
    }
    function settle(uint256 id,uint256[2] calldata a,uint256[2][2] calldata b,uint256[2] calldata c,uint256[9] calldata s) external {
        Job storage job=jobs[id];if(job.status!=Status.Pending)revert InvalidJob();if(block.timestamp>=job.deadline)revert Expired();
        // signals: risk, input commitment, context commitment, chain, consumer, job, requester, worker, model
        if(s[0]>1||s[1]!=job.commitment||s[3]!=block.chainid||s[4]!=uint256(uint160(address(this)))||s[5]!=id||s[6]!=uint256(uint160(job.requester))||s[7]!=uint256(uint160(msg.sender))||s[8]!=modelId)revert InvalidContext();
        if(!verifier.verifyProof(a,b,c,s))revert InvalidProof();
        job.status=Status.Settled;job.risk=uint8(s[0]);job.worker=msg.sender;credits[msg.sender]+=job.reward;
        emit Settled(id,msg.sender,uint8(s[0]),job.reward);
    }
    function refund(uint256 id) external {
        Job storage job=jobs[id];if(job.status!=Status.Pending)revert InvalidJob();if(msg.sender!=job.requester)revert Unauthorized();if(block.timestamp<job.deadline)revert NotExpired();
        job.status=Status.Refunded;credits[msg.sender]+=job.reward;emit Refunded(id);
    }
    function withdraw() external {
        uint256 amount=credits[msg.sender];require(amount>0,"No credit");credits[msg.sender]=0;
        (bool success,)=msg.sender.call{value:amount}("");if(!success)revert TransferFailed();emit Withdrawn(msg.sender,amount);
    }
}
