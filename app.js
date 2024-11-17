const GAS_CONTRACT_ADDRESS = '0x4300000000000000000000000000000000000002'
const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const INIT_MAX_SUPPLY = 21000000
const INITIAL_REWARD = 250
const HALVING_INTERVAL = 42000

const urlParams = new URLSearchParams(window.location.search)
const VERSION = urlParams.get('v')

let CONTRACT_ADDRESS, ABI, web3, contract, gasContract, multicallContract, ethPrice, updateInterval, ethPriceInterval, WINNER_OFFSET

if (VERSION === '1') {
    CONTRACT_ADDRESS = '0x7E82481423B09c78e4fd65D9C1473a36E5aEd405'
    ABI = '/abi/v1.json'
    WINNER_OFFSET = 0
} else if (VERSION === '2') {
    CONTRACT_ADDRESS = '0x22B309977027D4987C3463774D7046d5136CB14a'
    ABI = '/abi/v2.json'
    WINNER_OFFSET = 0
} else { // v3
    CONTRACT_ADDRESS = '0xF8797dB8a9EeD416Ca14e8dFaEde2BF4E1aabFC3'
    ABI = '/abi/v3.json'
    WINNER_OFFSET = 1
}

document.getElementById('contract-link').href = `https://blastscan.io/address/${CONTRACT_ADDRESS}`

// ABI Loading
async function loadABIs() {
    try {
        const [contractResponse, gasResponse, multicallResponse] = await Promise.all([
            fetch(ABI),
            fetch('/abi/gas.json'),
            fetch('/abi/multicall.json')
        ])
        const contractABI = await contractResponse.json()
        const gasABI = await gasResponse.json()
        const multicallABI = await multicallResponse.json()
        return { contractABI, gasABI, multicallABI }
    } catch (error) {
        console.error('Error loading ABIs:', error)
        throw error
    }
}

// Price Functions
async function getEthPrice() {
    try {
        // Try CoinGecko first
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
        const data = await response.json()
        if (data?.ethereum?.usd) {
            return data.ethereum.usd
        }
        throw new Error('Invalid CoinGecko response')
    } catch (error) {
        console.warn('CoinGecko API failed, falling back to CryptoCompare:', error)
        try {
            // Fallback to CryptoCompare
            const response = await fetch('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD')
            const data = await response.json()
            if (data?.USD) {
                return data.USD
            }
            throw new Error('Invalid CryptoCompare response')
        } catch (fallbackError) {
            console.error('Both price APIs failed:', fallbackError)
            return null
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
            target: CONTRACT_ADDRESS,
            callData: contract.methods.blockNumber().encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.totalSupply().encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.miningReward().encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.lastBlockTime().encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.halvingInterval().encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.lastHalvingBlock().encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.tokenValue().encodeABI()
        },
        {
            target: GAS_CONTRACT_ADDRESS,
            callData: gasContract.methods.readGasParams(CONTRACT_ADDRESS).encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.minersPerBlockCount(LAST_HYPERS_BLOCK + 1).encodeABI()
        },
        {
            target: CONTRACT_ADDRESS,
            callData: contract.methods.maxSupply().encodeABI()
        },
        {
            target: MULTICALL_ADDRESS,
            callData: multicallContract.methods.getBasefee().encodeABI()
        },
        {
            target: MULTICALL_ADDRESS,
            callData: multicallContract.methods.getEthBalance(CONTRACT_ADDRESS).encodeABI()
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
    const intrinsicValueUsd = (parseFloat(intrinsicValueEth) * ethPrice).toFixed(6)
    
    // Calculate theoretical value based on TVL
    const theoreticalValueEth = (parseFloat(tvlEth) / parseFloat(totalSupplyEth)).toFixed(10)
    const theoreticalValueUsd = (parseFloat(theoreticalValueEth) * ethPrice).toFixed(6)
    
    return { 
        intrinsicValueEth, 
        intrinsicValueUsd,
        theoreticalValueEth,
        theoreticalValueUsd
    }
}

let LAST_HYPERS_BLOCK = 0
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
    document.getElementById('lastBlock').textContent = blockNumber
    document.getElementById('totalSupply').textContent = formatNumber(Math.round(totalSupply/1e18))
    document.getElementById('minerReward').textContent = minerReward/1e18
    document.getElementById('minersCount').textContent = LAST_HYPERS_BLOCK == 0 ? '...' : minersCount
    
    // Update values
    document.getElementById('intrinsicValue').textContent = intrinsicValueUsd
    document.getElementById('intrinsicValueEth').textContent = intrinsicValueEth
    document.getElementById('theoreticalValue').textContent = theoreticalValueUsd
    document.getElementById('theoreticalValueEth').textContent = theoreticalValueEth
    document.getElementById('tvl').textContent = parseFloat(tvlEth).toFixed(2)
    document.getElementById('tvlUsd').textContent = formatNumber(Math.round(parseFloat(tvlEth) * ethPrice))
    document.getElementById('maxSupply').textContent = formatNumber(maxSupply/1e18)

    // Update tokens metrics
    const burned = calculateBurnedTokens(maxSupply/1e18)
    document.getElementById('burnedAmount').textContent = formatNumber(Math.round(burned.amount))
    document.getElementById('burnedPercentage').textContent = burned.percentage

    const mined = calculateMinedTokens(burned.amount, totalSupply/1e18)
    document.getElementById('minedPercentage').textContent = mined.percentage
    document.getElementById('minedAmount').textContent = formatNumber(Math.round(mined.amount))

    // Update time metrics
    const secondsAgo = Math.floor((Date.now() / 1000) - lastBlockTime)
    document.getElementById('lastBlockTime').textContent = `${formatSecondsAgo(secondsAgo)}`
    updatePendingBlockProgress(secondsAgo)

    document.getElementById('pendingBlockMinerCount').textContent = minersCount
    document.getElementById('pendingBlockReward').textContent = minerReward/1e18
    document.getElementById('pendingBlockWinner').textContent = `${secondsAgo}s`

    // Update gas price
    const gasPriceGwei = web3.utils.fromWei(values.gasPrice, 'gwei')
    document.getElementById('gasPrice').textContent = `${parseFloat(gasPriceGwei).toFixed(4)} Gwei`
    document.getElementById('gasPriceUsd').textContent = `$${(parseFloat(gasPriceGwei) * ethPrice * 0.000000001 * 25000000).toFixed(2)}`
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

function formatSecondsAgo(seconds) {
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
    const [minersCount, { winner, miner }] = await Promise.all([
        contract.methods.minersPerBlockCount(blockNumber).call(),
        getBlockMinerWinner(blockNumber)
    ])

    return {
        blockNumber,
        minersCount,
        winner,
        reward: calculateReward(blockNumber),
        miner
    }
}


let earliestEthBlockFetched = null
let latestEthBLockFetched = null
let cachedEvents = {}

async function getBlockEvent(blockNumber) {
    if (cachedEvents[blockNumber]) return cachedEvents[blockNumber]

    const blocksScroll = document.getElementById('blocksScroll')
    const existingBlocks = Array.from(blocksScroll.children)
    let fromBlock, toBlock
    
    // Initialize these values if they're null
    if (earliestEthBlockFetched === null || latestEthBLockFetched === null) {
        earliestEthBlockFetched = latestEthBLockFetched = await web3.eth.getBlockNumber()
    }
    
    if (isNewBlock(blockNumber, existingBlocks)) {
        fromBlock = latestEthBLockFetched - 600
        toBlock = 'latest'
    } else {
        fromBlock = earliestEthBlockFetched - 600
        toBlock = earliestEthBlockFetched
    }

    const newBlockTopic = '0x58ab9d8b9ae9ad7e2baee835f3d3fe920b93baf574a51df42c0390491f7297e9'
    const filter = {
        address: CONTRACT_ADDRESS,
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

        const decoded = web3.eth.abi.decodeLog([
            { type: 'uint256', name: 'blockNumber', indexed: false },
            { type: 'address', name: 'miner', indexed: false }
        ], event.data, event.topics)

        cachedEvents[decoded.blockNumber] = event
        cachedWinners[decoded.blockNumber - WINNER_OFFSET] = decoded.miner
    }
    if (cachedEvents[blockNumber]) {
        return cachedEvents[blockNumber]
    } else {
        throw new Error(`No event found for block ${blockNumber}`)
    }
}


let cachedWinners = {}
let cachedMiners = {}
async function getBlockMinerWinner(blockNumber) {
    if (LAST_HYPERS_BLOCK < blockNumber) return { winner: 'pending', miner: 'pending' }
    if(!cachedMiners[blockNumber]) {
        const event = await getBlockEvent(blockNumber)
        const tx = await web3.eth.getTransaction(event.transactionHash)
        cachedMiners[blockNumber] = tx.from
    }
    const winner = cachedWinners[blockNumber] ? cachedWinners[blockNumber] : 'pending'
    return { winner: winner, miner: cachedMiners[blockNumber] }
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
    const winnerString = `<span class="mdi mdi-party-popper"></span> ${formatAddress(cachedWinners[LAST_HYPERS_BLOCK - 1])}`
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

function formatAddress(address) {
    if (address === 'pending') return 'Pending...'
    if (address === 'unknown' || typeof address === 'undefined') return 'Unknown'
    
    const knownAddresses = {
        '0xb82619C0336985e3EDe16B97b950E674018925Bb': 'KONKPool',
        '0x2099A5d5DA9db8a91a21b7a1Cf7f969a5D078C15': 'Machi',
        '0x6B8c262CA939adbe3793D3eca519a9D64f74D184': 'Machi'
    }
    
    return knownAddresses[address] || address.substring(38)
}

function createBlockElement(data) {
    const block = document.createElement('div')
    let winnerAddress
    if (data.winner === 'pending') {
        winnerAddress = `<small style="color: var(--text-secondary);">Pending winner...</small>`
    } else {
        winnerAddress = `<span class="mdi mdi-party-popper"></span> ${formatAddress(data.winner)}`
    }
    block.className = 'block'
    block.id = `block-${data.blockNumber}`
    block.innerHTML = `
        <div class="block-number">#${data.blockNumber}</div>
        <div class="block-miner-count">
            ${data.minersCount}
            <span class="mdi mdi-pickaxe"></span>
        </div>
        <div class="block-winner">
            ${winnerAddress}
        </div>
        <div class="block-reward">
            ${data.reward} HYPERS
        </div>
        <div class="block-miner">
            <span class="mdi mdi-file-sign"></span>
            ${formatAddress(data.miner)}
        </div>
    `
    
    block.onclick = () => showBlockMiners(data.blockNumber, data.minersCount)
    return block
}

function createPendingBlockElement() {
    const block = document.createElement('div')
    block.className = 'block'
    block.id = 'pendingBlock'
    block.innerHTML = `
        <div class="block-number" id="pendingBlockNumber"></div>
        <div class="block-miner-count">
            <span id="pendingBlockMinerCount">...</span>
            <span class="mdi mdi-pickaxe"></span>
        </div>
        <div class="block-winner" id="pendingBlockWinner">...</div>
        <div class="block-reward">
            <span id="pendingBlockReward">...</span>
            $HYPERS
        </div>
        <div class="block-miner">Pending block</div>
    `
    
    block.onclick = () => showBlockMiners(LAST_HYPERS_BLOCK + 1, parseInt(document.getElementById('pendingBlockMinerCount').textContent))
    return block
}

async function getBlockMiners(blockNumber, totalMiners) {
    const BATCH_SIZE = 5000; // Number of miners to fetch per multicall
    const miners = {}
    
    try {
        // Calculate number of batches needed
        const batchCount = Math.ceil(totalMiners / BATCH_SIZE)
        
        for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
            const startIndex = batchIndex * BATCH_SIZE
            const endIndex = Math.min(startIndex + BATCH_SIZE, totalMiners)
            
            // Build calls for this batch
            const calls = []
            for (let minerIndex = startIndex; minerIndex < endIndex; minerIndex++) {
                calls.push({
                    target: CONTRACT_ADDRESS,
                    callData: contract.methods.minersPerBlock(blockNumber, minerIndex).encodeABI()
                })
            }
            
            // Execute multicall for this batch
            const results = await multicall(calls)
            
            // Decode results and add to miners array
            for (let i = 0; i < results.length; i++) {
                const minerAddress = web3.eth.abi.decodeParameter('address', results[i])
                miners[minerAddress] = (miners[minerAddress] || 0) + 1
            }
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
    blockDetails.innerHTML = await renderBlockDetails(blockNumber, minersCount, {})

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
    const isLoading = Object.keys(miners).length === 0
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
                <div class="miner-item">
                    <p class="miner-count">${count}
                        <span class="mdi mdi-pickaxe"></span>
                    </p>
                    <p><small>${(count / minersCount * 100).toFixed(2)}% chance</small></p>
                    <a href="https://blastscan.io/address/${address}" target="_blank">
                        <b>${formatAddress(address)}</b>
                    </a>
                </div>`)

    const { winner, miner } = await getBlockMinerWinner(blockNumber)
    let minerUrl, winnerUrl
    if (blockNumber > LAST_HYPERS_BLOCK) {
        minerUrl = '#'
        winnerUrl = '#'
    } else {
        minerUrl = `https://blastscan.io/tx/${cachedEvents[blockNumber].transactionHash}`
        winnerUrl = cachedEvents[blockNumber + WINNER_OFFSET] ? `https://blastscan.io/tx/${cachedEvents[blockNumber + WINNER_OFFSET].transactionHash}` : `#`
    }
    const reward = calculateReward(blockNumber)
    return `
        <p>Block #${blockNumber > LAST_HYPERS_BLOCK ? 'pending' : blockNumber}</p>

        <div class="miners-list">
            <div class="miner-item">
                <p class="bold">
                    ${minersCount}
                    <span class="mdi mdi-pickaxe"></span>
                </p>
                <small>Miners in block</small>
            </div>
            <a href="${winnerUrl}" target="_blank">
                <div class="miner-item">
                    <p class="bold">
                        <span class="mdi mdi-party-popper"></span>
                        ${formatAddress(winner)}
                    </p>
                    <small>Winner</small>
                </div>
            </a>
            <div class="miner-item">
                <p class="bold">
                    ${reward} HYPERS
                </p>
                <small>Reward minted</small>
            </div>
            <a href="${minerUrl}" target="_blank">
                <div class="miner-item">
                    <p class="bold">
                        <span class="mdi mdi-file-sign"></span>
                        ${formatAddress(miner)}
                    </p>
                    <small>Block issuer</small>
                </div>
            </a>
        </div>
        <p style="margin-top: 20px;">Miners:</p>
        <div class="miners-list">
            ${items.join('')}
        </div>
    `
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

let currentMinerCache = null
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

        LAST_HYPERS_BLOCK = parseInt(decoded.blockNumber)
        const isPendingBlockActive = document.getElementById('pendingBlock').classList.contains('active')
        if (isPendingBlockActive && currentMinerCache !== parseInt(decoded.minersCount)) {
            currentMinerCache = parseInt(decoded.minersCount)
            await updateBlockMiners(LAST_HYPERS_BLOCK + 1, currentMinerCache)
        }
        console.log(`Updating block ${LAST_HYPERS_BLOCK}`)
        await loadBlock(LAST_HYPERS_BLOCK)
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
        if (updateInterval) clearInterval(updateInterval)
        if (ethPriceInterval) clearInterval(ethPriceInterval)

        const { contractABI, gasABI, multicallABI } = await loadABIs()
        ethPrice = await getEthPrice()
        if (!ethPrice) {
            console.error('Failed to get ETH price')
            return
        }
        
        web3 = new Web3('https://rpc.blast.io')
        contract = new web3.eth.Contract(contractABI, CONTRACT_ADDRESS)
        gasContract = new web3.eth.Contract(gasABI, GAS_CONTRACT_ADDRESS)
        multicallContract = new web3.eth.Contract(multicallABI, MULTICALL_ADDRESS)
        const pendingBlock = createPendingBlockElement()
        document.getElementById('blocksScroll').appendChild(pendingBlock)
        await updateAllMetrics()
        initializeInfiniteScroll()
        updateInterval = setInterval(updateAllMetrics, 1000)
        ethPriceInterval = setInterval(async () => {
            ethPrice = await getEthPrice()
        }, 60000)
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
    return new Intl.NumberFormat('en-US').format(parseFloat(num))
}

function calculateMinedTokens(burnedAmount, totalSupply) {
    let totalMined = burnedAmount + totalSupply
    
    const percentage = (totalMined / INIT_MAX_SUPPLY) * 100

    return {
        amount: totalMined,
        percentage: percentage.toFixed(2)
    }
}

// Fix the burned tokens calculation
function calculateBurnedTokens(maxSupply) {
    const burnedAmount = INIT_MAX_SUPPLY - maxSupply
    const burnedPercentage = (burnedAmount / INIT_MAX_SUPPLY) * 100
    
    return {
        amount: burnedAmount,
        percentage: burnedPercentage.toFixed(2)
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