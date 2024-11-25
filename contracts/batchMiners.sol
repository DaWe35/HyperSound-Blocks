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
        require(totalMiners <= 100000, "Too many miners");
        
        // Create a more reasonably sized array for tracking
        address[] memory uniqueMinersList = new address[](totalMiners);
        uint256[] memory minerCounts = new uint256[](totalMiners);
        uint256 uniqueMiners;
        
        // First pass: count occurrences and track unique miners
        for (uint256 i = 0; i < totalMiners;) {
            address miner = hypers.minersPerBlock(blockNumber, i);
            bool found = false;
            
            // Check if we've seen this miner before
            for (uint256 j = 0; j < uniqueMiners;) {
                if (uniqueMinersList[j] == miner) {
                    minerCounts[j]++;
                    found = true;
                    break;
                }
                unchecked { j++; }
            }
            
            if (!found) {
                uniqueMinersList[uniqueMiners] = miner;
                minerCounts[uniqueMiners] = 1;
                unchecked { uniqueMiners++; }
            }
            unchecked { i++; }
        }
        
        // Create result array
        MinerInfo[] memory result = new MinerInfo[](uniqueMiners);
        
        // Fill result array
        for (uint256 i = 0; i < uniqueMiners;) {
            result[i] = MinerInfo({
                minerAddress: uniqueMinersList[i],
                mineCount: minerCounts[i]
            });
            unchecked { i++; }
        }
        
        return result;
    }
}
