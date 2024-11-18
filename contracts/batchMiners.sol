// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IHypers {
    function minersPerBlock(uint256 blockNumber, uint256 index) external view returns (address);
    function minersPerBlockCount(uint256 blockNumber) external view returns (uint256);
}

contract BatchMiners {
    struct MinerInfo {
        address minerAddress;
        uint256 mineCount;
    }

    function aggregateMiners(address hypersContract, uint256 blockNumber) 
        external 
        view 
        returns (MinerInfo[] memory) 
    {
        IHypers hypers = IHypers(hypersContract);
        uint256 totalMiners = hypers.minersPerBlockCount(blockNumber);
        
        // First create an array of all miners
        address[] memory miners = new address[](totalMiners);
        for (uint256 i = 0; i < totalMiners; i++) {
            miners[i] = hypers.minersPerBlock(blockNumber, i);
        }
        
        // Count unique miners
        uint256 uniqueMiners = 0;
        for (uint256 i = 0; i < totalMiners; i++) {
            bool isUnique = true;
            for (uint256 j = 0; j < i; j++) {
                if (miners[i] == miners[j]) {
                    isUnique = false;
                    break;
                }
            }
            if (isUnique) {
                uniqueMiners++;
            }
        }
        
        // Create result array and fill it
        MinerInfo[] memory result = new MinerInfo[](uniqueMiners);
        uint256 resultIndex = 0;
        
        for (uint256 i = 0; i < totalMiners; i++) {
            bool found = false;
            // Check if we already processed this miner
            for (uint256 j = 0; j < resultIndex; j++) {
                if (result[j].minerAddress == miners[i]) {
                    result[j].mineCount++;
                    found = true;
                    break;
                }
            }
            // If not found, add as new entry
            if (!found) {
                result[resultIndex] = MinerInfo({
                    minerAddress: miners[i],
                    mineCount: 1
                });
                resultIndex++;
            }
        }
        
        return result;
    }
}
