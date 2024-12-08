const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

const urlParams = new URLSearchParams(window.location.search)
const VERSION = urlParams.get('v')

let web3
let ETH_PRICE, UPDATE_INTERVAL, ETH_PRICE_INTERVAL
let LAST_ETH_BLOCK = 0
let LAST_BLOCK_TIME = 0

const RPC_ENDPOINTS = [
    'https://eth.llamarpc.com',
    'https://ethereum.publicnode.com',
    'https://rpc.ankr.com/eth',
    'https://cloudflare-eth.com'
]

async function findWorkingRPC() {
    for (const rpc of RPC_ENDPOINTS) {
        try {
            const web3Test = new Web3(rpc)
            await web3Test.eth.getBlockNumber()
            console.log(`Using RPC: ${rpc}`)
            return rpc
        } catch (error) {
            console.warn(`RPC ${rpc} failed, trying next...`)
            continue
        }
    }
    throw new Error('No working RPC endpoint found')
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
    } else if (seconds < 7200) {
        return `${Math.floor(seconds / 60)} minutes`
    } else if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)} hours`
    } else {
        return `${Math.floor(seconds / 86400)} days`
    }
}

let loadedBlocks = new Set()

async function loadBlock(block) {
    if (loadedBlocks.has(block.number)) return
    
    try {
        loadedBlocks.add(block.number)
        const blockElement = createBlockElement(block)
        await insertBlockIntoDOM(blockElement, block.number)
    } catch (error) {
        console.error(`Error loading block ${block.number}:`, error)
    }
}

async function insertBlockIntoDOM(blockElement, blockNumber) {
    const blocksScroll = elem('#blocksScroll')
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
    const lastBlock = elem(`#block-${LAST_ETH_BLOCK - 1}`)
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

function formatAddress(address) {
    if (!address) return 'Contract Creation'
    if (address === 'pending') return 'Pending...'
    
    // We respect the privacy of our users, so please only add addresses that have been PUBLICLY associated with it's owner.
    const knownAddresses = {
        '0x0000000000000000000000000000000000000000': 'Zero Address',
        '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5': 'beaverbuild',
        '0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97': 'Titan Builder',
        '0x7e2a2FA2a064F693f0a55C5639476d913Ff12D05': 'MEV Builder',
        '0x388C818CA8B9251b393131C08a736A67ccB19297': 'Lido: Execution Layer Rewards Vault',
        '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326': 'rsync-builder.eth',
        '0x4675C7e5BaAFBFFbca748158bEcBA61ef3b0a263': 'Coinbase: MEV Builder',
        
    }
    
    return knownAddresses[address] || address.substring(2, 6) + '...' + address.substring(38)
}

// Add this helper function for relative time formatting
function formatTimeAgo(timestamp, showSeconds = true) {
    const seconds = Math.floor((Date.now() / 1000) - timestamp);
    
    if (seconds < 60 && showSeconds) {
        return `${seconds} seconds ago`;
    } else if (seconds < 60) {
        return 'just now';
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else {
        const days = Math.floor(seconds / 86400);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    }
}

function createBlockElement(block) {
    const blockElem = document.createElement('div')
    blockElem.className = 'block'
    blockElem.id = `block-${block.number}`

    const fillPercentage = Math.min(block.gasUsed / block.gasLimit * 100, 100)
    blockElem.style.setProperty('--fill-percentage', `${fillPercentage}%`)
    
    blockElem.innerHTML = `
        <div class="progress-bar"></div>
        <div class="block-decoration"></div>
        <div class="block-number">#${block.number}</div>
        <div class="block-miner-count">
            ${block.transactions.length}
            <span class="mdi mdi-swap-horizontal"></span>
        </div>
        <div class="block-gas" title="Block miner">
            <i class="mdi mdi-gas-station"></i>
            ${formatGasPrice(block.baseFeePerGas)}
        </div>
        <div class="block-reward" title="Block timestamp: ${block.timestamp}">
            <span class="time-ago" data-timestamp="${block.timestamp}">
                ${formatTimeAgo(block.timestamp, false)}
            </span>
        </div>
        <div class="block-miner" title="Block issuer">
            ${createBlockie(block.miner)} ${formatAddress(block.miner)}
        </div>
    `
    
    blockElem.onclick = () => showBlockDetails(block.number)
    return blockElem
}

function createPendingBlockElement() {
    const block = document.createElement('div')
    block.className = 'block'
    block.id = 'pendingBlock'
    
    block.innerHTML = `
        <div class="progress-bar"></div>
        <div class="block-decoration"></div>
        <div class="block-number">Pending...</div>
        <div class="block-miner-count">
            <span id="pendingBlockMinerCount">...</span>
            <span class="mdi mdi-swap-horizontal"></span>
        </div>
        <div class="block-gas">
            <small style="color: var(--text-secondary);">Pending...</small>
        </div>
        <div class="block-reward" id="pendingBlockWinner">...</div>
        <div class="block-miner">
            Pending...
        </div>
    `
    
    block.onclick = () => showBlockDetails(LAST_ETH_BLOCK + 1)
    return block
}

async function showBlockDetails(blockNumber) {
    const blockDetails = elem('#blockDetails')
    elems('.block').forEach(b => b.classList.remove('active'))
    
    let blockElement
    if (blockNumber > LAST_ETH_BLOCK) {
        blockElement = elem('#pendingBlock')
    } else {
        blockElement = elem(`#block-${blockNumber}`)
    }
    
    if (!blockElement) return
    
    blockElement.classList.add('active')
    blockDetails.classList.add('active')
    
    try {
        console.log('getBlock()', blockNumber)
        const block = await web3.eth.getBlock(blockNumber)
        if (!block) {
            blockDetails.innerHTML = '<p>Block details not available</p>'
            return
        }

        const transactions = await Promise.all(
            block.transactions.slice(0, 10).map(async txHash => {
                console.log('getTransaction() getTransactionReceipt()', txHash)
                const tx = await web3.eth.getTransaction(txHash)
                const receipt = await web3.eth.getTransactionReceipt(txHash)
                return { ...tx, status: receipt.status }
            })
        )

        blockDetails.innerHTML = `
            <div class="block-head-list">
                <div class="block-head-item">
                    <span class="mdi mdi-cube"></span>
                    Block #${block.number}
                </div>
                <div class="block-head-item">
                    <span class="mdi mdi-clock"></span>
                    Mined: <span class="time-ago" data-timestamp="${block.timestamp}">
                        ${formatTimeAgo(block.timestamp)}
                    </span>
                </div>
                <div class="block-head-item">
                    <span class="mdi mdi-pickaxe"></span>
                    Miner: <a href="https://etherscan.io/address/${block.miner}" target="_blank">
                        ${createBlockie(block.miner)} ${formatAddress(block.miner)}
                    </a>
                </div>
                <div class="block-head-item">
                    <span class="mdi mdi-gas-station"></span>
                    Gas Used: ${formatNumber(block.gasUsed)} / ${formatNumber(block.gasLimit)}
                    (${((block.gasUsed / block.gasLimit) * 100).toFixed(1)}%)
                </div>
            </div>
            <p style="margin-top: 30px; margin-bottom: 15px; font-size: 20px;">
                <span class="mdi mdi-swap-horizontal"></span>
                <b>${block.transactions.length}</b>
                transactions (showing first 10):
            </p>
            <div class="transactions-list">
                ${transactions.map(tx => `
                    <div class="transaction-item ${tx.status ? 'success' : 'failed'}">
                        <div class="tx-hash">
                            <a href="https://etherscan.io/tx/${tx.hash}" target="_blank">
                                ${tx.hash.substring(0, 10)}...${tx.hash.substring(58)}
                            </a>
                            ${tx.status ? 
                                '<span class="tx-status success">Success</span>' : 
                                '<span class="tx-status failed">Failed</span>'
                            }
                        </div>
                        <div class="tx-addresses">
                            From: ${formatAddress(tx.from)}
                            ${tx.to ? `To: ${formatAddress(tx.to)}` : '<span class="contract-creation">Contract Creation</span>'}
                        </div>
                        <div class="tx-value">
                            Value: ${web3.utils.fromWei(tx.value, 'ether')} ETH
                            ${tx.input && tx.input !== '0x' ? 
                                '<span class="contract-interaction">Contract Interaction</span>' : 
                                ''
                            }
                        </div>
                    </div>
                `).join('')}
            </div>
        `
    } catch (error) {
        console.error('Error showing block details:', error)
        blockDetails.innerHTML = '<p>Error loading block details</p>'
    }
}

function formatGasPrice(wei) {
    if (!wei) return '0.00 Gwei'
    const gwei = web3.utils.fromWei(wei, 'gwei')
    return `${parseFloat(gwei).toFixed(2)} Gwei`
}

// Initialize
async function init() {
    try {
        if (UPDATE_INTERVAL) clearInterval(UPDATE_INTERVAL)
        if (ETH_PRICE_INTERVAL) clearInterval(ETH_PRICE_INTERVAL)

        await updateEthPrice()
        
        // Find working RPC
        const rpcUrl = await findWorkingRPC()
        web3 = new Web3(rpcUrl)
        
        const pendingBlock = createPendingBlockElement()
        elem('#blocksScroll').appendChild(pendingBlock)
        
        await updateAllMetrics()
        initializeInfiniteScroll()
        
        UPDATE_INTERVAL = setInterval(() => {
            updateAllMetrics()
            updateRelativeTimes()
        }, 1000)
        
        ETH_PRICE_INTERVAL = setInterval(updateEthPrice, 60000)
        
        console.log('getBlockNumber()')
        const latestBlock = await web3.eth.getBlockNumber()
        loadInitialBlocks(latestBlock - 1)
    } catch (error) {
        console.error('Initialization error:', error)
    }
}

async function loadInitialBlocks(blockNumber) {
    for (let i = 0; i < 9; i++) {
        await sleep(100)
        console.log('getBlock()', blockNumber - i)
        const block = await web3.eth.getBlock(blockNumber - i)
        await loadBlock(block)
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
    const container = elem('.blocks-container')
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
            for (let i = 1; i <= 10; i++) {
                await sleep(200)
                console.log('getBlock()', oldestBlock - i)
                const block = await web3.eth.getBlock(oldestBlock - i)
                await loadBlock(block)
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

function getSecondsAgo(timestamp) {
    return Math.floor(Date.now() / 1000) - timestamp
}

function animatePendingBlock(secondsAgo) {
    // Calculate fill percentage (100% at 0s, 0% at 15s for ETH's ~15s block time)
    const fillPercentage = Math.min(100, (secondsAgo / 12) * 100)
    document.documentElement.style.setProperty('--fill-percentage', `${fillPercentage}%`)
}

// Add new function to update metrics for ETH blocks
async function updateAllMetrics() {
    try {
        console.log('getBlock(pending)')
        const pendingBlock = await web3.eth.getBlock('pending')
        const latestBlock = pendingBlock.number

        if (LAST_ETH_BLOCK !== latestBlock) {
            LAST_ETH_BLOCK = latestBlock

            // get latest block
            console.log('getBlock()', LAST_ETH_BLOCK)
            const block = await web3.eth.getBlock(LAST_ETH_BLOCK)
            LAST_BLOCK_TIME = block.timestamp
            
            await loadBlock(block)

            // Update gas metrics
            const gasPrice = web3.utils.fromWei(block.baseFeePerGas, 'gwei')
            const gasPriceUsd = (parseFloat(gasPrice) * ETH_PRICE * 0.000000001 * 21000).toFixed(3)
            
            elem('#gasPrice').textContent = `${parseFloat(gasPrice).toFixed(2)} Gwei`
            elem('#gasPriceUsd').textContent = `$${gasPriceUsd} per transaction`
            
            // Update block metrics
            elem('#blockNumber').textContent = latestBlock
            elem('#gasUsed').textContent = formatNumber(block.gasUsed)
            elem('#gasLimit').textContent = formatNumber(block.gasLimit)
            elem('#gasUtilization').textContent = `${((block.gasUsed / block.gasLimit) * 100).toFixed(1)}%`
        }

        // Update pending block info
        const secondsAgo = getSecondsAgo(LAST_BLOCK_TIME)
        animatePendingBlock(secondsAgo)
        elem('#pendingBlockWinner').textContent = formatSeconds(secondsAgo)
        
        // Update ETH price
        if (ETH_PRICE) {
            elem('#ethPrice').textContent = formatNumber(ETH_PRICE)
        }

        // Update transaction count in pending block
        if (pendingBlock && pendingBlock.transactions) {
            elem('#pendingBlockMinerCount').textContent = pendingBlock.transactions.length
        }
    } catch (error) {
        console.error('Error updating metrics:', error)
    }
}

// Add function to update all relative timestamps
function updateRelativeTimes() {
    elems('.time-ago').forEach(element => {
        const timestamp = element.dataset.timestamp
        if (timestamp) {
            // Check if this element is inside the latest block
            const isLatestBlock = element.closest('.block')?.id === `block-${LAST_ETH_BLOCK}`
            // Show seconds only for the latest block
            element.textContent = formatTimeAgo(timestamp, !isLatestBlock)
        }
    })
}

// Initialize
init()

// Add this to your existing init() function or create a new function
function initializeExternalLinks() {
    const modal = elem('#external-link-modal')
    const urlDisplay = modal.querySelector('.external-url')
    const modalTitle = elem('#modal-title')
    const modalContent = elem('#modal-content')
    let pendingUrl = ''

    // Handle button links
    elems('.button-link').forEach(link => {
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

// Helper function for sleeping
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}