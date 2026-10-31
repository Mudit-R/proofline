// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 17636363955606691650835147404695146605806032008005272837786903393621382269215;
    uint256 constant alphay  = 2845697403950286538776849366907138194570417609452226297686921841035547566588;
    uint256 constant betax1  = 11584188188657297989155403773806189257141730976168268975266026888341134427932;
    uint256 constant betax2  = 18245016211806311157794100890004556783454905017867271242027034188349870092909;
    uint256 constant betay1  = 7184774410343508292537601131639110991293476987838596106082169346567037906164;
    uint256 constant betay2  = 19201327565791523582604488492510087726445530334311021986724858149970894712882;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 10324606156787096359233304283049841947830391749747688074982613642134668756204;
    uint256 constant deltax2 = 4363478309498631197019632193539106810695957760796347527123659882336729196733;
    uint256 constant deltay1 = 18637375402832846187650606527927517572009887090343379118007792008461818354665;
    uint256 constant deltay2 = 17202197065525097263422825377913280169278376876637457346186625408110567418090;


    uint256 constant IC0x = 18179639388773554580035327123464137522287543415917786599468406946335470338911;
    uint256 constant IC0y = 3949103378953199630779260235381265966832715246216646974983110713151659790734;

    uint256 constant IC1x = 7214330333526949529122586927903734914996591164463672609978348951730333687020;
    uint256 constant IC1y = 13498245152187237351012636003327190119409890436551500406397840411208469946125;

    uint256 constant IC2x = 1654367968603250978627694740456272597129716719510614710119919224537796435072;
    uint256 constant IC2y = 6048123479264391088277243855826299844197287402721691957358742278982424657461;

    uint256 constant IC3x = 4589466128109003525021553740072086021546290301030057015207772486387398394243;
    uint256 constant IC3y = 13568954356363825072970490456548881755964169564687613716631869959030802121308;

    uint256 constant IC4x = 4891393047972885267402850049864915082996384243412231031356361876252323733779;
    uint256 constant IC4y = 9517122008368277949786172669557582762971275628658316470114644221427884158015;

    uint256 constant IC5x = 2463818828018783639099030068284710251023203945589912912368354236040174316546;
    uint256 constant IC5y = 21363034779794316727707418407336332124177972264645998357839705834099795749778;

    uint256 constant IC6x = 11439887465166272390045740510202668009420592112662625545537851424675379853994;
    uint256 constant IC6y = 15211380250441237047629988898410725703693589718773350753357180253832500281685;

    uint256 constant IC7x = 14264721562685890519739982625103527245557060595746903115922348460594803967930;
    uint256 constant IC7y = 20795973433223648402011454258505458344068278685595710268336263842058040362182;

    uint256 constant IC8x = 21212214580185983023065392600618899854531106733678013065699252159042994341949;
    uint256 constant IC8y = 14941161493339136798120191763553701279326343479183254226694333892218271326797;

    uint256 constant IC9x = 13875884312222437053806939214306482925304242808302166482233552343276819445656;
    uint256 constant IC9y = 18073562095513839848402362801177410098372935670034367662811265073027803102005;


    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[9] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x

                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))

                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))

                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))

                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))

                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))

                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))

                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))

                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))

                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))


                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F

            checkField(calldataload(add(_pubSignals, 0)))

            checkField(calldataload(add(_pubSignals, 32)))

            checkField(calldataload(add(_pubSignals, 64)))

            checkField(calldataload(add(_pubSignals, 96)))

            checkField(calldataload(add(_pubSignals, 128)))

            checkField(calldataload(add(_pubSignals, 160)))

            checkField(calldataload(add(_pubSignals, 192)))

            checkField(calldataload(add(_pubSignals, 224)))

            checkField(calldataload(add(_pubSignals, 256)))


            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
