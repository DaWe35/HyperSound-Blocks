const CONTRACT_ADDRESS = '0xF8797dB8a9EeD416Ca14e8dFaEde2BF4E1aabFC3';
const GAS_CONTRACT_ADDRESS = '0x4300000000000000000000000000000000000002';
const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
let web3;
let contract;
let gasContract;
let ethPrice;
let updateInterval;
let ethPriceInterval;

// ABI Loading
async function loadABIs() {
    try {
        const [contractResponse, gasResponse] = await Promise.all([
            fetch('/abi/v3.json'),
            fetch('/abi/gas.json')
        ]);
        const contractABI = await contractResponse.json();
        const gasABI = await gasResponse.json();
        return { contractABI, gasABI };
    } catch (error) {
        console.error('Error loading ABIs:', error);
        throw error;
    }
}

// Price Functions
async function getEthPrice() {
    try {
        // Try CoinGecko first
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await response.json();
        if (data?.ethereum?.usd) {
            return data.ethereum.usd;
        }
        throw new Error('Invalid CoinGecko response');
    } catch (error) {
        console.warn('CoinGecko API failed, falling back to CryptoCompare:', error);
        try {
            // Fallback to CryptoCompare
            const response = await fetch('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD');
            const data = await response.json();
            if (data?.USD) {
                return data.USD;
            }
            throw new Error('Invalid CryptoCompare response');
        } catch (fallbackError) {
            console.error('Both price APIs failed:', fallbackError);
            return null;
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
    }, [calls]);

    const response = await web3.eth.call({
        to: MULTICALL_ADDRESS,
        data: calldata
    });

    return web3.eth.abi.decodeParameters(['uint256', 'bytes[]'], response)[1];
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
        }
    ];
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
        gasParams: web3.eth.abi.decodeParameters(['uint256', 'uint256'], results[7])
    };
}

// TVL Calculations
async function calculateTVL(gasParams) {
    const balance = await web3.eth.getBalance(CONTRACT_ADDRESS);
    const tvl = web3.utils.toBN(balance).add(web3.utils.toBN(gasParams[1]));
    return web3.utils.fromWei(tvl, 'ether');
}

// Value Calculations
function calculateValues(tokenValue, totalSupply, tvlEth) {
    // Convert totalSupply to ETH units
    const totalSupplyEth = web3.utils.fromWei(totalSupply, 'ether');
    
    // Calculate intrinsic value
    const intrinsicValueEth = parseFloat(web3.utils.fromWei(tokenValue, 'ether')).toFixed(10);
    const intrinsicValueUsd = (parseFloat(intrinsicValueEth) * ethPrice).toFixed(6);
    
    // Calculate theoretical value based on TVL
    const theoreticalValueEth = (parseFloat(tvlEth) / parseFloat(totalSupplyEth)).toFixed(10);
    const theoreticalValueUsd = (parseFloat(theoreticalValueEth) * ethPrice).toFixed(6);
    
    return { 
        intrinsicValueEth, 
        intrinsicValueUsd,
        theoreticalValueEth,
        theoreticalValueUsd
    };
}

// UI Updates
function updateUI(values, tvlEth) {
    const {
        blockNumber, minerReward, minersCount, lastBlockTime,
        intrinsicValueEth, intrinsicValueUsd,
        theoreticalValueEth, theoreticalValueUsd
    } = values;

    document.getElementById('lastBlock').textContent = blockNumber;
    document.getElementById('totalSupply').textContent = formatNumber(web3.utils.fromWei(values.totalSupply, 'ether'));
    document.getElementById('minerReward').textContent = web3.utils.fromWei(minerReward, 'ether');
    document.getElementById('minersCount').textContent = minersCount;
    
    document.getElementById('intrinsicValue').textContent = intrinsicValueUsd;
    document.getElementById('intrinsicValueEth').textContent = intrinsicValueEth;
    document.getElementById('theoreticalValue').textContent = theoreticalValueUsd;
    document.getElementById('theoreticalValueEth').textContent = theoreticalValueEth;
    document.getElementById('tvl').textContent = parseFloat(tvlEth).toFixed(2);
}

// Time Updates
function updateLastBlockTime(lastBlockTime) {
    const secondsAgo = Math.floor((Date.now() / 1000) - lastBlockTime);
    document.getElementById('lastBlockTime').textContent = `${secondsAgo}s`;
}

function updateNextHalving(currentBlock, lastHalvingBlock, halvingInterval) {
    const blocksUntilHalving = (parseInt(lastHalvingBlock) + parseInt(halvingInterval)) - currentBlock;
    const hoursUntilHalving = Math.floor(blocksUntilHalving * 60 / 3600);
    document.getElementById('nextHalving').textContent = hoursUntilHalving;
}

// Main Update Function
async function updateAllMetrics() {
    try {
        const calls = buildContractCalls();
        const results = await multicall(calls);
        const decoded = decodeResults(results);
        
        const tvlEth = await calculateTVL(decoded.gasParams);
        const nextBlock = parseInt(decoded.blockNumber) + 1;
        const minersCount = await contract.methods.minersPerBlockCount(nextBlock).call();
        
        const values = calculateValues(decoded.tokenValue, decoded.totalSupply, tvlEth);
        
        updateUI({ ...decoded, ...values, minersCount }, tvlEth);
        updateLastBlockTime(decoded.lastBlockTime);
        updateNextHalving(decoded.blockNumber, decoded.lastHalvingBlock, decoded.halvingInterval);

        console.log('Contract State:', { 
            ...decoded, 
            tvlEth, 
            ethPrice,
            theoreticalValueEth: values.theoreticalValueEth,
            theoreticalValueUsd: values.theoreticalValueUsd
        });
    } catch (error) {
        console.error('Error updating metrics:', error);
        const metrics = ['lastBlock', 'totalSupply', 'minerReward', 'minersCount', 
                        'lastBlockTime', 'nextHalving', 'intrinsicValue', 'theoreticalValue',
                        'intrinsicValueEth', 'theoreticalValueEth', 'tvl'];
        metrics.forEach(id => document.getElementById(id).textContent = '...');
    }
}

// Initialization
async function init() {
    try {
        if (updateInterval) clearInterval(updateInterval);
        if (ethPriceInterval) clearInterval(ethPriceInterval);

        const { contractABI, gasABI } = await loadABIs();
        ethPrice = await getEthPrice();
        if (!ethPrice) {
            console.error('Failed to get ETH price');
            return;
        }
        
        web3 = new Web3('https://rpc.blast.io');
        contract = new web3.eth.Contract(contractABI, CONTRACT_ADDRESS);
        gasContract = new web3.eth.Contract(gasABI, GAS_CONTRACT_ADDRESS);
        
        await updateAllMetrics();
        updateInterval = setInterval(updateAllMetrics, 1000);
        ethPriceInterval = setInterval(async () => {
            ethPrice = await getEthPrice();
        }, 60000);
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(parseFloat(num));
}

// Initialize
init(); 