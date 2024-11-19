const GAS_HYPERS_ADDRESS = '0x4300000000000000000000000000000000000002'
const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const BATCH_MINERS_ADDRESS = '0x46b83472F2a3A51d5F5b222139b13Df6Bf942CC8'
const INIT_MAX_SUPPLY = 21000000
const INITIAL_REWARD = 250
const HALVING_INTERVAL = 42000

const urlParams = new URLSearchParams(window.location.search)
const VERSION = urlParams.get('v')

let HYPERS_ADDRESS, ABI, web3, contract, gasContract, multicallContract, batchMinersContract
let ETH_PRICE, UPDATE_INTERVAL, ETH_PRICE_INTERVAL
let WINNER_OFFSET
let LAST_HYPERS_BLOCK = 0
let LAST_HYPERS_BLOCK_TIME = 0

if (VERSION === '1') {
    HYPERS_ADDRESS = '0x7E82481423B09c78e4fd65D9C1473a36E5aEd405'
    ABI = '/contracts/abi/v1.json'
    WINNER_OFFSET = 0
} else if (VERSION === '2') {
    HYPERS_ADDRESS = '0x22B309977027D4987C3463774D7046d5136CB14a'
    ABI = '/contracts/abi/v2.json'
    WINNER_OFFSET = 0
} else { // v3
    HYPERS_ADDRESS = '0xF8797dB8a9EeD416Ca14e8dFaEde2BF4E1aabFC3'
    ABI = '/contracts/abi/v3.json'
    WINNER_OFFSET = 1
}

document.getElementById('contract-link').href = `https://blastscan.io/address/${HYPERS_ADDRESS}`

// ABI Loading
async function loadABIs() {
    try {
        const [contractResponse, gasResponse, multicallResponse, batchMinersResponse] = await Promise.all([
            fetch(ABI),
            fetch('/contracts/abi/gas.json'),
            fetch('/contracts/abi/multicall.json'),
            fetch('/contracts/abi/batchminers.json')
        ])
        const contractABI = await contractResponse.json()
        const gasABI = await gasResponse.json()
        const multicallABI = await multicallResponse.json()
        const batchMinersABI = await batchMinersResponse.json()
        return { contractABI, gasABI, multicallABI, batchMinersABI }
    } catch (error) {
        console.error('Error loading ABIs:', error)
        throw error
    }
}

// Price Functions
async function updateEthPrice() {
    try {
        // Try CoinGecko first
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
        const data = await response.json()
        if (data?.ethereum?.usd) {
            ETH_PRICE = data.ethereum.usd
        } else {
            throw new Error('Invalid CoinGecko response')
        }
    } catch (error) {
        console.warn('CoinGecko API failed, falling back to CryptoCompare:', error)
        try {
            // Fallback to CryptoCompare
            const response = await fetch('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD')
            const data = await response.json()
            if (data?.USD) {
                ETH_PRICE = data.USD
            } else {
                throw new Error('Invalid CryptoCompare response')
            }
        } catch (fallbackError) {
            console.error('Both price APIs failed:', fallbackError)
            ETH_PRICE = null
        }
    }
}

// Multicall Helper
async function multicall(calls) {
    const calldata = web3.eth.abi.encodeFunctionCall({
        name: 'aggregate',
        type: 'function',
        inputs: [{
            components: [
                { name: 'target', type: 'address' },
                { name: 'callData', type: 'bytes' }
            ],
            name: 'calls',
            type: 'tuple[]'
        }],
        outputs: [
            { name: 'blockNumber', type: 'uint256' },
            { name: 'returnData', type: 'bytes[]' }
        ]
    }, [calls])

    const response = await web3.eth.call({
        to: MULTICALL_ADDRESS,
        data: calldata
    })

    return web3.eth.abi.decodeParameters(['uint256', 'bytes[]'], response)[1]
}

// Contract Call Builders
function buildContractCalls() {
    return [
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.blockNumber().encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.totalSupply().encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.miningReward().encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.lastBlockTime().encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.halvingInterval().encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.lastHalvingBlock().encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.tokenValue().encodeABI()
        },
        {
            target: GAS_HYPERS_ADDRESS,
            callData: gasContract.methods.readGasParams(HYPERS_ADDRESS).encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.minersPerBlockCount(LAST_HYPERS_BLOCK + 1).encodeABI()
        },
        {
            target: HYPERS_ADDRESS,
            callData: contract.methods.maxSupply().encodeABI()
        },
        {
            target: MULTICALL_ADDRESS,
            callData: multicallContract.methods.getBasefee().encodeABI()
        },
        {
            target: MULTICALL_ADDRESS,
            callData: multicallContract.methods.getEthBalance(HYPERS_ADDRESS).encodeABI()
        }
    ]
}

// Result Decoders
function decodeResults(results) {
    return {
        blockNumber: web3.eth.abi.decodeParameter('uint256', results[0]),
        totalSupply: web3.eth.abi.decodeParameter('uint256', results[1]),
        minerReward: web3.eth.abi.decodeParameter('uint256', results[2]),
        lastBlockTime: web3.eth.abi.decodeParameter('uint256', results[3]),
        halvingInterval: web3.eth.abi.decodeParameter('uint256', results[4]),
        lastHalvingBlock: web3.eth.abi.decodeParameter('uint256', results[5]),
        tokenValue: web3.eth.abi.decodeParameter('uint256', results[6]),
        gasParams: web3.eth.abi.decodeParameters(['uint256', 'uint256'], results[7]),
        minersCount: web3.eth.abi.decodeParameter('uint256', results[8]),
        maxSupply: web3.eth.abi.decodeParameter('uint256', results[9]),
        baseFee: web3.eth.abi.decodeParameter('uint256', results[10]),
        ethBalance: web3.eth.abi.decodeParameter('uint256', results[11])
    }
}

// TVL Calculations
async function calculateTVL(gasParams, ethBalance) {
    const tvl = web3.utils.toBN(ethBalance).add(web3.utils.toBN(gasParams[1]))
    return web3.utils.fromWei(tvl, 'ether')
}

// Value Calculations
function calculateValues(tokenValue, totalSupply, tvlEth) {

    // Convert totalSupply to ETH units
    const totalSupplyEth = web3.utils.fromWei(totalSupply, 'ether')
    
    // Calculate intrinsic value
    const intrinsicValueEth = parseFloat(web3.utils.fromWei(tokenValue, 'ether')).toFixed(10)
    const intrinsicValueUsd = (parseFloat(intrinsicValueEth) * ETH_PRICE).toFixed(6)
    
    // Calculate theoretical value based on TVL
    const theoreticalValueEth = (parseFloat(tvlEth) / parseFloat(totalSupplyEth)).toFixed(10)
    const theoreticalValueUsd = (parseFloat(theoreticalValueEth) * ETH_PRICE).toFixed(6)

    return { 
        intrinsicValueEth, 
        intrinsicValueUsd,
        theoreticalValueEth,
        theoreticalValueUsd
    }
}
// UI Updates
function updateUI(values, tvlEth) {
    const {
        blockNumber, minerReward, minersCount, lastBlockTime,
        intrinsicValueEth, intrinsicValueUsd,
        theoreticalValueEth, theoreticalValueUsd,
        maxSupply, totalSupply
    } = values

    // Update metrics
    LAST_HYPERS_BLOCK = blockNumber
    document.getElementById('totalSupply').textContent = formatNumber(Math.round(totalSupply/1e18))
    document.getElementById('minerReward').textContent = minerReward/1e18
    document.getElementById('minerRewardUsd').textContent = (minerReward/1e18 * intrinsicValueUsd).toFixed(3)
    document.getElementById('minersCount').textContent = LAST_HYPERS_BLOCK == 0 ? '...' : minersCount
    
    // Update values
    document.getElementById('intrinsicValue').textContent = intrinsicValueUsd
    document.getElementById('intrinsicValueEth').textContent = intrinsicValueEth
    document.getElementById('theoreticalValue').textContent = theoreticalValueUsd
    document.getElementById('theoreticalValueEth').textContent = theoreticalValueEth
    document.getElementById('tvl').textContent = parseFloat(tvlEth).toFixed(2)
    document.getElementById('tvlUsd').textContent = formatNumber(Math.round(parseFloat(tvlEth) * ETH_PRICE))
    document.getElementById('maxSupply').textContent = formatNumber(maxSupply/1e18)

    // Update tokens metrics
    const burned = calculateBurnedTokens(maxSupply/1e18)
    document.getElementById('burnedPercentage').textContent = burned.percentage.toFixed(0)

    const mined = calculateMinedTokens(burned.amount, totalSupply/1e18)
    document.getElementById('minedPercentage').textContent = mined.percentage.toFixed(0)

    // Update time metrics
    LAST_HYPERS_BLOCK_TIME = Math.floor((Date.now() / 1000) - lastBlockTime)
    updatePendingBlockProgress(LAST_HYPERS_BLOCK_TIME)

    document.getElementById('pendingBlockMinerCount').textContent = minersCount
    document.getElementById('pendingBlockReward').textContent = minerReward/1e18
    document.getElementById('pendingBlockWinner').textContent = formatSeconds(LAST_HYPERS_BLOCK_TIME)

    // Update gas price
    const gasPriceGwei = web3.utils.fromWei(values.gasPrice, 'gwei')
    document.getElementById('gasPrice').textContent = `${parseFloat(gasPriceGwei).toFixed(5)} Gwei`
    document.getElementById('gasPriceUsd').textContent = `$${(parseFloat(gasPriceGwei) * ETH_PRICE * 0.000000001 * 25000000).toFixed(3)}`
}

function formatTimeUntil(hours) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    const minutes = Math.floor((remainingHours % 1) * 60)

    let result = ''
    if (days > 0) result += `${days}d `
    if (remainingHours > 0) result += `${Math.floor(remainingHours)}h `
    if (minutes > 0) result += `${minutes}m`
    
    return result.trim() || '0m'
}

function formatSeconds(seconds) {
    if (!seconds) return 'Unknown'
    if (seconds < 300) {
        return `${seconds}s`
    } else if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)} hours`
    } else {
        return `${Math.floor(seconds / 86400)} days`
    }
}

function updateNextHalving(currentBlock, lastHalvingBlock, halvingInterval) {
    const blocksUntilHalving = (parseInt(lastHalvingBlock) + parseInt(halvingInterval)) - currentBlock
    const hoursUntilHalving = blocksUntilHalving * 60 / 3600; // 60 seconds per block
    document.getElementById('nextHalving').textContent = formatTimeUntil(hoursUntilHalving)
}

function calculateReward(blockNumber) {
    // Initial reward is 250 HYPERS
    let reward = 250
    
    const halvings = Math.floor(blockNumber / HALVING_INTERVAL)
    
    // Reduce reward by half for each halving that has occurred
    for (let i = 0; i < halvings; i++) {
        reward = reward / 2
    }
    return reward
}

let loadedBlocks = new Set()

async function loadBlock(blockNumber) {
    if (loadedBlocks.has(blockNumber)) return
    
    try {
        loadedBlocks.add(blockNumber)
        const blockData = await fetchBlockData(blockNumber)
        const blockElement = createBlockElement(blockData)
        await insertBlockIntoDOM(blockElement, blockNumber)
    } catch (error) {
        console.error(`Error loading block ${blockNumber}:`, error)
    }
}

async function fetchBlockData(blockNumber) {
    const [minersCount, blockTime] = await Promise.all([
        contract.methods.minersPerBlockCount(blockNumber).call(),
        getBlockTime(blockNumber)
    ])

    const { winner, miner } = await getBlockMinerWinner(blockNumber)

    return {
        blockNumber,
        minersCount,
        winner,
        reward: calculateReward(blockNumber),
        miner,
        blockTime
    }
}


let earliestEthBlockFetched = null
let latestEthBLockFetched = null
let cachedEvents = {}

async function getNewBlockEvent(blockNumber) {
    if (cachedEvents[blockNumber]) return cachedEvents[blockNumber]

    const blocksScroll = document.getElementById('blocksScroll')
    const existingBlocks = Array.from(blocksScroll.children)
    let fromBlock, toBlock
    
    // Initialize these values if they're null
    if (earliestEthBlockFetched === null || latestEthBLockFetched === null) {
        earliestEthBlockFetched = latestEthBLockFetched = VERSION === '1' ? 7820907 : await web3.eth.getBlockNumber()
    }
    
    if (isNewBlock(blockNumber, existingBlocks)) {
        fromBlock = latestEthBLockFetched - 600
        toBlock = 'latest'
    } else {
        fromBlock = earliestEthBlockFetched - 600
        toBlock = earliestEthBlockFetched
    }

    const newBlockTopic = VERSION === '1' ? '0x7fe090037171b6c8b269016189ef1438c336d360d819447a441fe06865776049' : '0x58ab9d8b9ae9ad7e2baee835f3d3fe920b93baf574a51df42c0390491f7297e9'
    const filter = {
        address: HYPERS_ADDRESS,
        topics: [newBlockTopic],
        fromBlock: fromBlock,
        toBlock: toBlock
    }
    const events = await web3.eth.getPastLogs(filter)
    
    for (const event of events) {
        if (event.blockNumber > latestEthBLockFetched) {
            latestEthBLockFetched = event.blockNumber
        }
        if (event.blockNumber < earliestEthBlockFetched) {
            earliestEthBlockFetched = event.blockNumber
        }
        
        const decoded = decodeNewBlockEvent(event)
        cachedEvents[decoded.blockNumber] = event
        if (VERSION !== '1') {
            cachedWinners[decoded.blockNumber - WINNER_OFFSET] = decoded.miner
        } else {
            cachedWinners[decoded.blockNumber] = 'unknown'
        }
    }
    
    if (cachedEvents[blockNumber]) {
        return cachedEvents[blockNumber]
    } else {
        console.log(`No event found for block ${blockNumber}`)
        return null
    }
}

function decodeNewBlockEvent(event) {
    let decoded
    if (VERSION === '1') {
        decoded = web3.eth.abi.decodeLog([
            { type: 'uint256', name: 'blockNumber', indexed: false }
        ], event.data, event.topics)
    } else {
        decoded = web3.eth.abi.decodeLog([
            { type: 'uint256', name: 'blockNumber', indexed: false },
            { type: 'address', name: 'miner', indexed: false }
        ], event.data, event.topics)
    }
    return decoded
}


let cachedWinners = {}
let cachedMiners = {}
let cachedBlockTimes = {}
async function fetchBlockExtra(blockNumber) {
    if(!cachedMiners[blockNumber]) {
        const event = await getNewBlockEvent(blockNumber)
        if (!event) return false
        const tx = await web3.eth.getTransaction(event.transactionHash)
        const block = await web3.eth.getBlock(tx.blockNumber)
        cachedMiners[blockNumber] = tx.from
        cachedBlockTimes[blockNumber] = block.timestamp
    }
    return true
}


async function getBlockMinerWinner(blockNumber) {
    if (LAST_HYPERS_BLOCK < blockNumber) return { winner: 'pending', miner: 'pending' }
    if(!cachedMiners[blockNumber]) {
        await fetchBlockExtra(blockNumber)
    }
    const winner = cachedWinners[blockNumber] ? cachedWinners[blockNumber] : 'pending'
    const miner = cachedMiners[blockNumber]
    return { winner: winner, miner: miner }
}

async function getBlockTime(blockNumber) {
    await fetchBlockExtra(blockNumber)
    await fetchBlockExtra(blockNumber - 1)
    if (cachedBlockTimes[blockNumber] && cachedBlockTimes[blockNumber - 1]) {
        return cachedBlockTimes[blockNumber] - cachedBlockTimes[blockNumber - 1]
    }
    if (blockNumber === LAST_HYPERS_BLOCK + 1) {
        return LAST_HYPERS_BLOCK_TIME
    }
    return null
}

async function insertBlockIntoDOM(blockElement, blockNumber) {
    const blocksScroll = document.getElementById('blocksScroll')
    const existingBlocks = Array.from(blocksScroll.children)
    if (isNewBlock(blockNumber, existingBlocks)) {
        insertNewBlock(blockElement, existingBlocks, blocksScroll)
    } else {
        insertHistoricalBlock(blockElement, existingBlocks, blocksScroll)
    }
}

function isNewBlock(blockNumber, existingBlocks) {
    return existingBlocks.length > 1 && 
        blockNumber > parseInt(existingBlocks[1].querySelector('.block-number').textContent.slice(1))
}

function insertNewBlock(blockElement, existingBlocks, blocksScroll) {
    // Reset any existing animations
    existingBlocks.forEach(block => {
        block.classList.remove('slide-in')
        block.classList.remove('fade-in')
        void(block.offsetWidth); // Trigger CSS reflow
    })
    
    // Add new block with animations
    blockElement.classList.add('fade-in')
    blocksScroll.insertBefore(blockElement, existingBlocks[1])
    
    // Animate existing blocks
    existingBlocks.slice(1).forEach(block => {
        block.classList.add('slide-in')
    })

    // update latest -1 block winner
    const lastBlock = document.getElementById(`block-${LAST_HYPERS_BLOCK - 1}`)
    const winnerString = `${createBlockie(cachedWinners[LAST_HYPERS_BLOCK - 1])} ${formatAddress(cachedWinners[LAST_HYPERS_BLOCK - 1])}`
    lastBlock.querySelector('.block-winner').innerHTML = winnerString
}

function insertHistoricalBlock(blockElement, existingBlocks, blocksScroll) {
    const insertIndex = findInsertPosition(blockElement, existingBlocks)
    
    if (insertIndex > 0) {
        blocksScroll.insertBefore(blockElement, existingBlocks[insertIndex])
    } else {
        blocksScroll.appendChild(blockElement)
    }
}

function findInsertPosition(blockElement, existingBlocks) {
    return existingBlocks.findIndex(block => {
        const existingBlockNumber = parseInt(block.querySelector('.block-number').textContent.slice(1))
        const newBlockNumber = parseInt(blockElement.querySelector('.block-number').textContent.slice(1))
        return newBlockNumber > existingBlockNumber
    })
}

function createBlockie(address, size = 8, scale = 2, isIcon = false) {
    if (address === 'pending' || address === 'unknown' || typeof address === 'undefined') {
        return ''
    }
    
    const canvas = blockies.create({
        seed: address.toLowerCase(),
        size: size,
        scale: scale
    })
    
    if (isIcon) {
        // Return a div that uses the blockie as background with MDI icon mask
        return `<span class="blockie-icon mdi mdi-party-popper" style="background-image: url('${canvas.toDataURL()}');"></span>`
    }
    
    return `<img src="${canvas.toDataURL()}" class="blockie-img" style="width: ${size * scale}px; height: ${size * scale}px;" />`
}

function formatAddress(address, useIconBlockie = false) {
    if (address === 'pending') return 'Pending...'
    if (address === 'unknown' || typeof address === 'undefined') return 'Unknown'
    
    const knownAddresses = {
        '0xb82619C0336985e3EDe16B97b950E674018925Bb': 'KONKPool',
        '0xdB14eEd121138c4C44F2Bd2441980CeC80539Df9': 'KONKPool',
        '0x2099A5d5DA9db8a91a21b7a1Cf7f969a5D078C15': 'Machi',
        '0x6B8c262CA939adbe3793D3eca519a9D64f74D184': 'Machi',
        '0x020cA66C30beC2c4Fe3861a94E4DB4A498A35872': 'Machi',
        '0xa0df6ADAa4f7e880b4B3C40147C6ae92124d88a8': 'v2 exploiter',
        '0x8b3B7036A67aE1bCCB631Fa23fa69172f2592b19': 'v2 exploiter',
        '0x4aBf167D88Be803B944617343Acb0b267E0eC265': 'v2 exploiter',
        '0x11879103A01619fb9f982C75B1d5056520B57846': 'v2 exploiter',
        '0x5F6fD9d880BE6e209d5ee7a5517DfB40B8a9d81B': 'v2 exploiter', // https://intel.arkm.com/explorer/address/0x5F6fD9d880BE6e209d5ee7a5517DfB40B8a9d81B
        '0x7F448F0435803744Bcda76afED4F17B0A6E0FB23': 'Big BadWolf',
        '0x311111036921FfA417d03Ab1a9Aaff09429f3D98': 'Teim',
        '0x379b1a0cD7330fC5e21a68cce1CdbD0A3E5C1Fc0': 'Julien',
        '0xD8e1cB737Bd1608ec9Ee19E8D00F2d9e020fA6D3': 'Julien',
        '0x526228544F39C0CBB5eC522682D0359d585E136D': 'Gra-Gra',
        '0x19c1c04CA24D38157FC85614ba765C7f6f844C95': 'Im so f sorry',
        '0x72aeF46A2b46fd078530A1A61E18BF68ff78EB0C': 'Rufina', // https://blastr.xyz/user/0x72aef46a2b46fd078530a1a61e18bf68ff78eb0c
        '0x4a5073642E143a9Ef35af6DED4d45bB711A27096': 'Rufina',
        '0xfde46ab2eBdc35d5fFA9b7bA41b5079f6103335F': 'Rufina',
        '0x07Db56c360E83C5035833A1Bd4B5841F21720575': 'Rufina',
        '0xc7937623E07FE88A442Ec4949664C51CaD8541fa': 'Rufina',
        '0xa97902225044B8FB61E95e62dC02263904F7538B': '0xYupa', // https://x.com/0xYupa/status/1824225965977055497
        '0x5792169336BB6c47Fe2dcff091751Ae90255090d': '0xYupa',
        '0x7d2e1E1aEaE6d9F91a75C9fb7e1B22E7135C0DeF': '0xYupa',
        '0x194b3496E9d2FfAe6AF332350d33Af8B21cA9b5d': 'Shoplifter', // https://intel.arkm.com/explorer/address/0x194b3496E9d2FfAe6AF332350d33Af8B21cA9b5d
        '0xaf88d946ef18b54ed35558ba5d03f737e40fcd39': 'etherlect', // https://blastr.xyz/user/0xAF88D946Ef18B54Ed35558BA5D03F737E40FCD39
        '0x1b123ec75EEB3636Ce6317ed7646f7dAB3fC2199': 'etherlect',
        '0xD51Ce9bE4a1cb6185B76Ba825C59236a6Cf5ca2A': 'mrk_eth', // https://intel.arkm.com/explorer/entity/mrk-eth
        '0xD55c42A4bEA00E19B02378EBA330d487dC44DE37': 'SkulzNFT', // https://intel.arkm.com/explorer/address/0xD55c42A4bEA00E19B02378EBA330d487dC44DE37
        '0xbd0B494819265E1ec610B33227861070b534c294': 'FrostyOogaboo', // https://intel.arkm.com/explorer/address/0xbd0B494819265E1ec610B33227861070b534c294
        '0x8F8B4759dC93CA55bD6997DF719F20F581F10F5C': 'pondermint', // https://intel.arkm.com/explorer/address/0x8F8B4759dC93CA55bD6997DF719F20F581F10F5C
    }
    
    return knownAddresses[address] || address.substring(2, 6) + '...' + address.substring(38)
}

function createBlockElement(data) {
    const block = document.createElement('div')
    
    let winnerAddress
    if (data.winner === 'pending') {
        winnerAddress = `<small style="color: var(--text-secondary);">Pending winner...</small>`
    } else {
        winnerAddress = `${formatAddress(data.winner)}`
    }
    block.className = 'block'
    block.id = `block-${data.blockNumber}`
    block.innerHTML = `
        <div class="block-decoration"></div>
        <div class="block-number">#${data.blockNumber}</div>
        <div class="block-miner-count">
            ${data.minersCount}
            <span class="mdi mdi-pickaxe"></span>
        </div>
        <div class="block-winner" title="Block reward winner">
            ${createBlockie(data.winner)} ${winnerAddress}
        </div>
        <div class="block-reward">
            ${formatSeconds(data.blockTime)}
        </div>
        <div class="block-miner" title="Block issuer">
            ${createBlockie(data.miner)} ${formatAddress(data.miner)}
        </div>
    `
    
    block.onclick = () => showBlockMiners(data.blockNumber, data.minersCount)
    return block
}

function createPendingBlockElement() {
    const block = document.createElement('div')
    block.className = 'block'
    block.id = 'pendingBlock'
    
    // Add progress bar div
    block.innerHTML = `
        <div class="progress-bar"></div>
        <div class="block-decoration"></div>
        <div class="block-number" id="pendingBlockNumber"></div>
        <div class="block-miner-count">
            <span id="pendingBlockMinerCount">...</span>
            <span class="mdi mdi-pickaxe"></span>
        </div>
        <div class="block-winner">
            <small style="color: var(--text-secondary);">
                <span id="pendingBlockReward">...</span>
                $HYPERS
            </small>
        </div>
        <div class="block-reward" id="pendingBlockWinner">...</div>
        <div class="block-miner">Pending block</div>
    `
    
    block.onclick = () => showBlockMiners(LAST_HYPERS_BLOCK + 1, parseInt(document.getElementById('pendingBlockMinerCount').textContent))
    return block
}

async function getBlockMiners(blockNumber) {
    try {
        const miners = {}
        const minersArray = await batchMinersContract.methods.aggregateMiners(HYPERS_ADDRESS, blockNumber).call()

        // format to an array like [ miner1: 10, miner2: 20 ]
        for (let i = 0; i < minersArray.length; i++) {
            const minerAddress = minersArray[i].minerAddress
            miners[minerAddress] = (miners[minerAddress] || 0) + parseInt(minersArray[i].mineCount)
        }
        return miners
    } catch (error) {
        console.error(`Error fetching miners for block ${blockNumber}:`, error)
        return []
    }
}

async function showBlockMiners(blockNumber, minersCount) {
    const blockDetails = document.getElementById('blockDetails')
    // Remove active class from all blocks first
    document.querySelectorAll('.block').forEach(b => b.classList.remove('active'))
    let blockElement
    if (blockNumber > LAST_HYPERS_BLOCK) {
        blockElement = document.getElementById(`pendingBlock`)
    } else {
        blockElement = document.getElementById(`block-${blockNumber}`)
    }
    blockElement.classList.add('active')
    blockDetails.classList.add('active')
    blockElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    blockDetails.innerHTML = await renderBlockDetails(blockNumber, minersCount, null)

    if (blockNumber === null) return
    await updateBlockMiners(blockNumber, minersCount)

}

async function updateBlockMiners(blockNumber, minersCount) {
    const blockDetails = document.getElementById('blockDetails')
    try {
        const miners = await getBlockMiners(blockNumber, parseInt(minersCount))
        blockDetails.innerHTML = await renderBlockDetails(blockNumber, minersCount, miners)
    } catch (error) {
        console.error('Error showing block miners:', error)
    }
}

async function renderBlockDetails(blockNumber, minersCount, miners) {
    const { winner, miner } = await getBlockMinerWinner(blockNumber)
    const blockTime = await getBlockTime(blockNumber)

    const isLoading = miners === null
    const items = isLoading 
        ? Array(4).fill(`
            <div class="miner-item loading">
                <p class="miner-count">...</p>
                <br>
                <p class="loading-address">Loading...</p>
            </div>`)
        : Object.entries(miners)
            .sort((a, b) => b[1] - a[1])
            .map(([address, count]) => `
                <div class="miner-item ${winner === address ? 'winner-shadow' : ''}">
                    <p class="miner-count">${count}
                        <span class="mdi mdi-pickaxe"></span>
                    </p>
                    <p><small>${(count / minersCount * 100).toFixed(2)}% chance</small></p>
                    <a href="https://blastscan.io/address/${address}" target="_blank">
                        <b>${createBlockie(address, 8, 3)} ${formatAddress(address)}</b>
                    </a>
                </div>`)

    let minerUrl, winnerUrl
    if (blockNumber > LAST_HYPERS_BLOCK || !cachedEvents[blockNumber]) {
        minerUrl = '#'
        winnerUrl = '#'
    } else {
        minerUrl = `https://blastscan.io/tx/${cachedEvents[blockNumber].transactionHash}`
        winnerUrl = cachedEvents[blockNumber + WINNER_OFFSET] ? `https://blastscan.io/tx/${cachedEvents[blockNumber + WINNER_OFFSET].transactionHash}` : `#`
    }
    const reward = calculateReward(blockNumber)
    return `
        <div class="block-head-list">
            <div class="block-head-item">
                <span class="mdi mdi-cube"></span>
                Block #${blockNumber > LAST_HYPERS_BLOCK ? 'pending' : blockNumber}
            </div>
            <div class="block-head-item" title="This block was mined in ${formatSeconds(blockTime)}">
                <span class="mdi mdi-clock"></span>
                Block time:
                <span class="block-detail-block-time bold">
                    ${formatSeconds(blockTime)}
                </span>
            </div>
            <div class="block-head-item" title="${formatAddress(winner)} won ${reward} HYPERS block reward">
                <span class="mdi mdi-party-popper"></span>
                Winner: 
                <a href="${winnerUrl}" title="${winner}" target="_blank" class="bold">
                    ${createBlockie(winner)} ${formatAddress(winner)}
                </a>
            </div>
            <div class="block-head-item" title="${formatAddress(miner)} finalized this block">
                <span class="mdi mdi-file-sign"></span>
                Block issuer:
                <a href="${minerUrl}" title="${miner}" target="_blank" class="bold">
                ${createBlockie(miner)} ${formatAddress(miner)}
                </a>
            </div>
        </div>
        <p style="margin-top: 30px; margin-bottom: 15px; font-size: 20px;">
            <span class="mdi mdi-pickaxe"></span>
            <b>${minersCount}</b>
            miners:
        </p>
        <div class="miners-list">
            ${items.join('')}
        </div>
    `
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

let CURRENT_MINERS = null
async function updateAllMetrics() {
    try {
        const calls = buildContractCalls()
        const results = await multicall(calls)

        const decoded = decodeResults(results)
        const tvlEth = await calculateTVL(decoded.gasParams, decoded.ethBalance)
        const values = calculateValues(decoded.tokenValue, decoded.totalSupply, tvlEth)
        
        const baseFee = web3.utils.toBN(decoded.baseFee)
        const gasPrice = baseFee.add(baseFee.muln(6).divn(100))
        values.gasPrice = gasPrice.toString()
        
        updateUI({ ...decoded, ...values }, tvlEth)
        updateNextHalving(decoded.blockNumber, decoded.lastHalvingBlock, decoded.halvingInterval)

        if (LAST_HYPERS_BLOCK !== parseInt(decoded.blockNumber)) {
            LAST_HYPERS_BLOCK = parseInt(decoded.blockNumber)
            await loadBlock(LAST_HYPERS_BLOCK)
        }
        const isPendingBlockActive = document.getElementById('pendingBlock').classList.contains('active')
        if (isPendingBlockActive) {
            const blockTimeElem = document.querySelector('.block-detail-block-time')
            if (blockTimeElem) {
                blockTimeElem.textContent = formatSeconds(LAST_HYPERS_BLOCK_TIME)
            }
            if (CURRENT_MINERS !== parseInt(decoded.minersCount)) {
                CURRENT_MINERS = parseInt(decoded.minersCount)
                await updateBlockMiners(LAST_HYPERS_BLOCK + 1, CURRENT_MINERS)
            }
        }
    } catch (error) {
        console.error('Error updating metrics:', error)
        const metrics = ['lastBlock', 'totalSupply', 'minerReward', 'minersCount', 
                        'lastBlockTime', 'nextHalving', 'intrinsicValue', 'theoreticalValue',
                        'intrinsicValueEth', 'theoreticalValueEth', 'tvl', 'gasPrice']
        metrics.forEach(id => document.getElementById(id).textContent = '...')
    }
}

// Initialization
async function init() {
    try {
        if (UPDATE_INTERVAL) clearInterval(UPDATE_INTERVAL)
        if (ETH_PRICE_INTERVAL) clearInterval(ETH_PRICE_INTERVAL)

        const { contractABI, gasABI, multicallABI, batchMinersABI } = await loadABIs()
        await updateEthPrice()
        
        web3 = new Web3('https://rpc.blast.io')
        contract = new web3.eth.Contract(contractABI, HYPERS_ADDRESS)
        gasContract = new web3.eth.Contract(gasABI, GAS_HYPERS_ADDRESS)
        multicallContract = new web3.eth.Contract(multicallABI, MULTICALL_ADDRESS)
        batchMinersContract = new web3.eth.Contract(batchMinersABI, BATCH_MINERS_ADDRESS)
        const pendingBlock = createPendingBlockElement()
        document.getElementById('blocksScroll').appendChild(pendingBlock)
        await updateAllMetrics()

        initializeInfiniteScroll()
        UPDATE_INTERVAL = setInterval(updateAllMetrics, 1000)
        ETH_PRICE_INTERVAL = setInterval(updateEthPrice, 60000)
        initializeExternalLinks()
        loadInitialBlocks(LAST_HYPERS_BLOCK - 1)
    } catch (error) {
        console.error('Initialization error:', error)
    }
}

async function loadInitialBlocks(blockNumber) {
    for (let i = 0; i < 9; i++) {
        await sleep(100)
        await loadBlock(blockNumber - i)
    }
}

function formatNumber(num) {
    num = parseFloat(num)
    if (num >= 1000000) {
        return (num / 1000000).toFixed(0) + 'M'
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'k'
    }
    return new Intl.NumberFormat('en-US').format(num)
}

function calculateMinedTokens(burnedAmount, totalSupply) {
    let totalMined = burnedAmount + totalSupply
    
    const percentage = (totalMined / INIT_MAX_SUPPLY) * 100

    return {
        amount: totalMined,
        percentage: percentage
    }
}

// Fix the burned tokens calculation
function calculateBurnedTokens(maxSupply) {
    const burnedAmount = INIT_MAX_SUPPLY - maxSupply
    const burnedPercentage = (burnedAmount / INIT_MAX_SUPPLY) * 100
    
    return {
        amount: burnedAmount,
        percentage: burnedPercentage
    }
}

// Remove the load more button from HTML

// Remove the load more button event listener and add scroll detection
function initializeInfiniteScroll() {
    const container = document.querySelector('.blocks-container')
    let isDragging = false
    let startX
    let scrollLeft
    let hasMoved = false

    container.addEventListener('mousedown', (e) => {
        isDragging = true
        hasMoved = false
        container.classList.add('dragging')
        startX = e.pageX - container.offsetLeft
        scrollLeft = container.scrollLeft
    })

    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return
        e.preventDefault()
        hasMoved = true
        const x = e.pageX - container.offsetLeft
        const walk = x - startX
        container.scrollLeft = scrollLeft - walk
    })

    // Handle scroll near edges for infinite loading
    container.addEventListener('scroll', debounce(async () => {
        const { scrollLeft, scrollWidth, clientWidth } = container
        if ((scrollWidth - (scrollLeft + clientWidth)) / clientWidth < 0.2) {
            const oldestBlock = Math.min(...Array.from(loadedBlocks))
            for (let i = 1; i <= 5; i++) {
                await sleep(100)
                await loadBlock(oldestBlock - i)
            }
        }
    }, 100))

    // Prevent click events if dragging occurred
    container.addEventListener('click', (e) => {
        if (hasMoved) {
            e.stopPropagation()
            e.preventDefault()
        }
    }, true)

    // Stop dragging
    window.addEventListener('mouseup', () => {
        isDragging = false
        container.classList.remove('dragging')
        // Reset hasMoved after a short delay to allow legitimate clicks
        setTimeout(() => {
            hasMoved = false
        }, 10)
    })

    window.addEventListener('mouseleave', () => {
        isDragging = false
        container.classList.remove('dragging')
    })
}

// Debounce helper
function debounce(func, wait) {
    let timeout
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout)
            func(...args)
        }
        clearTimeout(timeout)
        timeout = setTimeout(later, wait)
    }
}

function updatePendingBlockProgress(secondsAgo) {
    const pendingBlock = document.getElementById('pendingBlock')
    if (!pendingBlock) return
    
    // Calculate fill percentage (100% at 0s, 0% at 60s)
    const fillPercentage = Math.min(100, (secondsAgo / 60) * 100)
    pendingBlock.style.setProperty('--fill-percentage', `${fillPercentage}%`)
}

// Initialize
init(); 

// Add this to your existing init() function or create a new function
function initializeExternalLinks() {
    const modal = document.getElementById('external-link-modal')
    const urlDisplay = modal.querySelector('.external-url')
    const modalTitle = document.getElementById('modal-title')
    const modalContent = document.getElementById('modal-content')
    let pendingUrl = ''

    // Handle button links
    document.querySelectorAll('.button-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault()
            pendingUrl = link.dataset.externalUrl
            
            // Update modal with custom warning messages
            modalTitle.textContent = link.dataset.warningTitle
            modalContent.textContent = link.dataset.warningContent
            urlDisplay.textContent = pendingUrl
            
            modal.style.display = 'block'
        })
    })

    // Continue button
    modal.querySelector('.continue').addEventListener('click', () => {
        window.open(pendingUrl, '_blank')
        modal.style.display = 'none'
    })

    // Cancel button
    modal.querySelector('.cancel').addEventListener('click', () => {
        modal.style.display = 'none'
    })

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none'
        }
    })
}