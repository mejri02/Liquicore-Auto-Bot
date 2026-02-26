const fs = require('fs-extra');
const axios = require('axios');
const ethers = require('ethers');
const chalk = require('chalk');
const Table = require('cli-table3');
const { HttpsProxyAgent } = require('https-proxy-agent');
const moment = require('moment');
const Groq = require('groq-sdk');

const config = {
    baseUrl: "https://fckqnmehuebqmevkicgz.supabase.co",
    origin: "https://liquicore.finance",
    referer: "https://liquicore.finance/",
    apiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja3FubWVodWVicW1ldmtpY2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NzQ3NDksImV4cCI6MjA4NDQ1MDc0OX0.ryCrP8GkL68ORKerfisZ6kfmFjTcyl3UJx7S6cfHhmk",
    maxRetries: 5,
    retryDelay: 3000,
    dailyHour: 8,
    dailyMinute: 0,
    discordInterval: 30 * 60 * 1000,
    duelInterval: 5 * 60 * 60 * 1000,
    discordGuildId: "1460573383518322770",
    discordAppId: "1463169413485428747",
    faucets: [
        { name: "BNB", channelId: "1463389834239414415", customId: "claim_bnb" },
        { name: "USDC", channelId: "1471443448933519370", customId: "claim_s1tusdc" },
        { name: "USDT", channelId: "1471443514490490892", customId: "claim_s1tusdt" }
    ],
    useGroq: true,
    groqModel: "llama-3.3-70b-versatile"
};

const antiDetect = {
    minActionDelay: 2000,
    maxActionDelay: 8000,
    requestJitter: () => Math.floor(Math.random() * 2000) + 500,
    interactionDelay: () => Math.floor(Math.random() * 3000) + 1000,
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
    ],
    getRandomUA: function () {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    },
    generateSessionId: () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * chars.length)];
        return result;
    }
};

let accounts = [];
let configData = {};

try {
    accounts = require('./accounts.json');
    try {
        configData = require('./config.json');
        if (configData.grokApiKey) {
            config.grokApiKey = configData.grokApiKey;
        }
    } catch (e) {}
} catch (e) {
    console.log(chalk.red('❌ Error loading accounts.json'));
    process.exit(1);
}

let groqClient = null;
if (config.useGroq && config.grokApiKey) {
    try {
        groqClient = new Groq({
            apiKey: config.grokApiKey,
        });
        console.log(chalk.green('✅ Groq AI initialized successfully'));
    } catch (e) {}
}

const RPC_URLS = [
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545/',
    'https://data-seed-prebsc-2-s1.bnbchain.org:8545/',
    'https://bsc-testnet-rpc.publicnode.com'
];
let currentRpcIndex = 0;
let provider = new ethers.providers.JsonRpcProvider(RPC_URLS[currentRpcIndex]);

function rotateRpc() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
    provider = new ethers.providers.JsonRpcProvider(RPC_URLS[currentRpcIndex]);
}

const USDC_ADDR = '0xaD88B079712CC38a8D33E072CB6434E652556441';
const USDT_ADDR = '0x5c0d9bb86b99168Aa8A36fad84d068d258c259a5';
const VAULT_ADDR = '0xC044428E4f0b46C9897730fc9137806Ed8deBB9d';
const LAAS_VAULT_ADDR = '0xB8332cfE7DddD45CEcAADA6C0e564b09AbBb5744';
const DUEL_ADDR = '0xFbB6a304e361AE93B33A87a3700CC1CF1b2bAc8c';
const GOV_ADDR = '0xd53868E4b0c16ED332f37f005d4851D3EB547deB';

const DAILY_DUEL_LIMIT = 1;
const SAME_OPPONENT_LIMIT = 3;
const RATE_LIMIT_DUELS = 3;
const RATE_LIMIT_WINDOW = 2 * 60 * 1000;

const DUEL_ABI = [
    'function createDuel(uint256 wagerAmount, address wagerToken, uint8 duelType) returns (uint256)',
    'function acceptDuel(uint256 duelId)',
    'function cancelDuel(uint256 duelId)',
    'function claimAllPrizes()',
    'function claimAllRefunds()',
    'function duels(uint256) view returns (uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed)',
    'function duelCounter() view returns (uint256)',
    'function getOpenDuels() view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed)[])',
    'function getActiveDuels() view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed)[])',
    'function getUserDuels(address user) view returns (uint256[])',
    'function getDuel(uint256 duelId) view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed))'
];

const DUEL_STATUS = { PENDING: 0, ACTIVE: 1, RESOLVED: 2, CLAIMED: 3, CANCELLED: 4 };

const GOV_ABI = [
    'function vote(uint256 roundId, uint256 poolId, uint256 voteCount)'
];

const errorLogs = [];
const MAX_ERROR_LOGS = 10;
const state = {};

const createState = (index) => ({
    name: `Acc ${index + 1}`,
    points: '-',
    streak: '-',
    discordFaucet: '⏳',
    webFaucet: '⏳',
    dailyTask: '⏳',
    dailyQuiz: '⏳',
    govVote: '⏳',
    duelStatus: '⏳',
    nextDaily: null,
    nextDuel: null,
    nextDiscord: null,
    lastDiscord: 0,
    lastDaily: 0,
    lastDuel: 0,
    isProcessing: false,
    duelHistory: [],
    dailyDuelCount: 0,
    duelFailures: 0
});

const QUIZ_STATE = {
    date: '',
    answers: null,
    quizData: null
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomSleep = async () => await sleep(randomDelay(antiDetect.minActionDelay, antiDetect.maxActionDelay));

function formatTime(ms) {
    if (ms <= 0) return chalk.green("Ready");
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function getNextDailySchedule() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(config.dailyHour, config.dailyMinute, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next;
}

function getNextDiscordSchedule() {
    return new Date(Date.now() + config.discordInterval);
}

function logError(idx, msg, rawError = null) {
    const time = moment().format('HH:mm:ss');
    const logMsg = `[${time}] [Acc ${idx + 1}] ❌ ${msg}`;
    errorLogs.push(logMsg);
    if (errorLogs.length > MAX_ERROR_LOGS) errorLogs.shift();
    if (rawError) {
        console.log(chalk.red(`[Acc ${idx + 1}] Detailed Error:`), rawError.message || rawError);
        if (rawError.reason) console.log(chalk.red(`[Acc ${idx + 1}] Reason:`), rawError.reason);
    }
}

async function withRetry(fn, idx, actionName, maxRetries = config.maxRetries) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await sleep(antiDetect.requestJitter());
            const result = await fn();
            return { success: true, result };
        } catch (error) {
            lastError = error;
            const errorMsg = error.message || 'Unknown error';

            if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
                const waitTime = 30000 + (attempt * 10000);
                if (state[idx]) state[idx][actionName] = `⏳RL${attempt}`;
                await sleep(waitTime);
                continue;
            }

            if (errorMsg.includes('ECONNRESET') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('proxy')) {
                rotateRpc();
                if (state[idx]) state[idx][actionName] = `⏳R${attempt}`;
                await sleep(config.retryDelay * attempt);
                continue;
            }

            if (errorMsg.includes('already') || errorMsg.includes('cooldown')) {
                return { success: true, result: 'already_done' };
            }

            if (attempt < maxRetries) {
                if (state[idx]) state[idx][actionName] = `⏳R${attempt}`;
                await sleep(config.retryDelay * attempt);
            }
        }
    }

    const failReason = lastError?.reason || lastError?.message || 'Failed after 5 retries';
    logError(idx, `${actionName}: ${failReason.slice(0, 200)}`, lastError);
    return { success: false, error: lastError };
}

const BANNER = chalk.bold.cyan(`
    ╔══════════════════════════════════════╗
    ║     🔷 SIPAL LIQUICORE BOT 🔷       ║
    ║    Version 5.0 - S1 with Groq AI     ║
    ╚══════════════════════════════════════╝
`);

function clearScreen() {
    process.stdout.write('\x1B[2J\x1B[0f');
}

function renderDashboard() {
    clearScreen();
    process.stdout.write('\x1B[1;1H');

    console.log(BANNER);
    console.log(chalk.gray('═'.repeat(90)));
    
    const now = Date.now();
    
    Object.keys(state).sort((a, b) => parseInt(a) - parseInt(b)).forEach(idx => {
        const s = state[idx];
        const nextDailyMs = s.nextDaily ? s.nextDaily.getTime() - now : 0;
        const nextDuelMs = s.nextDuel ? s.nextDuel.getTime() - now : 0;
        const nextDiscordMs = s.nextDiscord ? s.nextDiscord.getTime() - now : 0;
        
        const nextDaily = formatTime(nextDailyMs);
        const nextDuel = formatTime(nextDuelMs);
        const nextDiscord = formatTime(nextDiscordMs);
        
        const formatStatus = (status) => {
            if (status === '✅') return chalk.green('✅');
            if (status === '❌') return chalk.red('❌');
            if (status.startsWith('⏳')) return chalk.yellow(status);
            if (status === '🔄') return chalk.cyan('🔄');
            return status;
        };
        
        console.log(chalk.white(`\n📊 ${s.name}`));
        console.log(chalk.gray('  ────────────────────────'));
        console.log(`  ${chalk.yellow('💰 Points')}     : ${chalk.white(s.points)}`);
        console.log(`  ${chalk.magenta('🔥 Streak')}     : ${chalk.white(s.streak)}`);
        console.log(`  ${chalk.blue('💬 Discord')}   : ${formatStatus(s.discordFaucet)}`);
        console.log(`  ${chalk.green('🌐 WebFaucet')}  : ${formatStatus(s.webFaucet)}`);
        console.log(`  ${chalk.cyan('📅 DailyTask')}  : ${formatStatus(s.dailyTask)}`);
        console.log(`  ${chalk.yellow('❓ Quiz')}       : ${formatStatus(s.dailyQuiz)}`);
        console.log(`  ${chalk.magenta('🗳️ Gov')}        : ${formatStatus(s.govVote)}`);
        console.log(`  ${chalk.red('⚔️ Duel')}       : ${formatStatus(s.duelStatus)}`);
        console.log(`  ${chalk.gray('⏰ Discord')}    : ${nextDiscord}`);
        console.log(`  ${chalk.gray('⏰ Daily')}      : ${nextDaily}`);
        console.log(`  ${chalk.gray('⏰ Duel')}       : ${nextDuel}`);
    });
    
    if (errorLogs.length > 0) {
        console.log(chalk.red.bold('\n⚠️  Error Logs:'));
        errorLogs.slice(-3).forEach(log => console.log(chalk.red(`  ${log}`)));
    }
    
    console.log(chalk.gray('\n' + '═'.repeat(90)));
    console.log(chalk.gray(`🕒 ${moment().format('HH:mm:ss')} | Press Ctrl+C to stop`));
    console.log(chalk.gray(`🤖 Groq AI: ${groqClient ? '✅ Active' : '❌ Disabled'}`));
}

function createClient(proxy) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const userAgent = antiDetect.getRandomUA();

    return axios.create({
        baseURL: config.baseUrl,
        httpsAgent: agent,
        timeout: 30000,
        headers: {
            'apikey': config.apiKey,
            'content-type': 'application/json',
            'origin': config.origin,
            'referer': config.referer,
            'user-agent': userAgent,
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'cross-site',
            'cache-control': 'no-cache',
            'pragma': 'no-cache'
        }
    });
}

function createDiscordClient(token, proxy) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    const sessionId = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    const launchId = [8, 4, 4, 4, 12].map(n => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')).join('-');

    return axios.create({
        timeout: 30000,
        httpsAgent: agent,
        headers: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': ua,
            'Origin': 'https://discord.com',
            'Referer': 'https://discord.com/channels/1460573383518322770/1471443514490490892',
            'X-Debug-Options': 'bugReporterEnabled',
            'X-Discord-Locale': 'en-US',
            'X-Discord-Timezone': 'Asia/Jakarta',
            'X-Super-Properties': Buffer.from(JSON.stringify({
                os: 'Mac OS X',
                browser: 'Chrome',
                device: '',
                system_locale: 'en-US',
                has_client_mods: false,
                browser_user_agent: ua,
                browser_version: '145.0.0.0',
                os_version: '10.15.7',
                referrer: '',
                referring_domain: '',
                referrer_current: '',
                referring_domain_current: '',
                release_channel: 'stable',
                client_build_number: 500462,
                client_event_source: null,
                client_launch_id: launchId,
                client_heartbeat_session_id: sessionId,
                client_app_state: 'focused'
            })).toString('base64')
        }
    });
}

async function getTokenBalance(wallet, tokenAddress) {
    try {
        const contract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], wallet);
        return await contract.balanceOf(wallet.address);
    } catch { return ethers.BigNumber.from(0); }
}

async function getAllowance(wallet, tokenAddress, spender) {
    try {
        const contract = new ethers.Contract(tokenAddress, ['function allowance(address, address) view returns (uint256)'], wallet);
        return await contract.allowance(wallet.address, spender);
    } catch { return ethers.BigNumber.from(0); }
}

async function ensureApproval(wallet, tokenAddress, spender) {
    const minAllowance = ethers.utils.parseUnits("100000", 18);
    const allowance = await getAllowance(wallet, tokenAddress, spender);
    if (allowance.gte(minAllowance)) return true;

    try {
        const data = '0x095ea7b3' + '000000000000000000000000' + spender.slice(2).toLowerCase() + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
        const tx = await wallet.sendTransaction({ to: tokenAddress, data, gasLimit: 200000, gasPrice });
        await tx.wait();
        return true;
    } catch (e) {
        console.log(chalk.red(`⚠️ Approval Error: ${e.reason || e.message}`));
        return false;
    }
}

async function claimWebFaucet(wallet, tokenAddress, idx) {
    const S1_FAUCET_ABI = [
        'function claimFaucet() external',
        'function canClaim(address) view returns (bool)',
        'function faucetAmount() view returns (uint256)',
        'function lastClaim(address) view returns (uint256)',
        'function nextResetTimestamp() view returns (uint256)'
    ];

    return await withRetry(async () => {
        const contract = new ethers.Contract(tokenAddress, S1_FAUCET_ABI, wallet);

        try {
            const canClaimResult = await contract.canClaim(wallet.address);
            if (!canClaimResult) {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Faucet not claimable yet for ${tokenAddress.slice(0, 10)}...`));
                try {
                    const nextReset = await contract.nextResetTimestamp();
                    const now = Math.floor(Date.now() / 1000);
                    const remaining = nextReset.toNumber() - now;
                    if (remaining > 0) {
                        const hours = Math.floor(remaining / 3600);
                        const mins = Math.floor((remaining % 3600) / 60);
                        console.log(chalk.gray(`[Acc ${idx + 1}] Faucet resets in: ${hours}h ${mins}m`));
                    }
                } catch { }
                return 'cooldown';
            }
        } catch (e) {
            console.log(chalk.gray(`[Acc ${idx + 1}] canClaim check failed, trying claim anyway: ${e.message?.slice(0, 50)}`));
        }

        const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
        const tx = await contract.claimFaucet({ gasLimit: 200000, gasPrice });
        const receipt = await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] ✅ Faucet claimed! TX: ${tx.hash.slice(0, 20)}... Block: ${receipt.blockNumber}`));
        return true;
    }, idx, 'webFaucet');
}

async function depositVault(wallet, type, idx, amount = 550, isFixed = false) {
    const tokenAddr = type === 1 ? USDC_ADDR : USDT_ADDR;
    const tokenName = type === 1 ? 'tUSDC' : 'tUSDT';
    const decimals = type === 1 ? 6 : 18;

    const bal = await getTokenBalance(wallet, tokenAddr);
    const balFormatted = ethers.utils.formatUnits(bal, decimals);
    console.log(chalk.gray(`[Acc ${idx + 1}] ${tokenName} Balance: ${balFormatted}`));

    let depositAmount;

    if (isFixed) {
        depositAmount = ethers.utils.parseUnits(amount.toString(), decimals);
        if (bal.lt(depositAmount)) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] Insufficient ${tokenName}: need ${amount}, have ${balFormatted}`));
            return { success: true, result: 'skip_insufficient' };
        }
    } else {
        const reserve = ethers.utils.parseUnits(amount.toString(), decimals);
        if (bal.lte(reserve)) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] ${tokenName} balance too low for reserve`));
            return { success: true, result: 'skip' };
        }
        depositAmount = bal.sub(reserve);
    }

    const depositFormatted = ethers.utils.formatUnits(depositAmount, decimals);
    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing ${depositFormatted} ${tokenName} to RLP Vault...`));

    return await withRetry(async () => {
        const approved = await ensureApproval(wallet, tokenAddr, VAULT_ADDR);
        if (!approved) throw new Error('Approval failed');

        const VAULT_ABI = ['function deposit(uint8 assetIdx, uint256 amount, uint8 tierIndex)'];
        const vaultContract = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);

        console.log(chalk.gray(`[Acc ${idx + 1}] RLP Vault deposit: assetIdx=${type}, amount=${depositFormatted}, tier=0`));

        const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
        const tx = await vaultContract.deposit(type, depositAmount, 0, { gasLimit: 500000, gasPrice });
        console.log(chalk.gray(`[Acc ${idx + 1}] TX Hash: ${tx.hash}`));

        const receipt = await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] ${tokenName} RLP Vault Deposit confirmed! Block: ${receipt.blockNumber}`));

        return true;
    }, idx, 'dailyTask');
}

async function depositLaaSVault(wallet, assetIdx, idx, amount, isFixed = true) {
    const tokenAddr = assetIdx === 1 ? USDC_ADDR : USDT_ADDR;
    const tokenName = assetIdx === 1 ? 'tUSDC' : 'tUSDT';
    const decimals = assetIdx === 1 ? 6 : 18;

    const bal = await getTokenBalance(wallet, tokenAddr);
    const balFormatted = ethers.utils.formatUnits(bal, decimals);
    console.log(chalk.gray(`[Acc ${idx + 1}] ${tokenName} Balance for LaaS: ${balFormatted}`));

    let depositAmount;

    if (isFixed) {
        depositAmount = ethers.utils.parseUnits(amount.toString(), decimals);
        if (bal.lt(depositAmount)) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] Insufficient ${tokenName} for LaaS: need ${amount}, have ${balFormatted}`));
            return { success: true, result: 'skip_insufficient' };
        }
    } else {
        depositAmount = bal;
    }

    const depositFormatted = ethers.utils.formatUnits(depositAmount, decimals);
    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing ${depositFormatted} ${tokenName} to LaaS Vault (Governance)...`));

    return await withRetry(async () => {
        const approved = await ensureApproval(wallet, tokenAddr, LAAS_VAULT_ADDR);
        if (!approved) throw new Error('LaaS Approval failed');

        const LAAS_ABI = ['function deposit(uint8 assetIdx, uint256 amount)'];
        const laasContract = new ethers.Contract(LAAS_VAULT_ADDR, LAAS_ABI, wallet);

        console.log(chalk.gray(`[Acc ${idx + 1}] LaaS Vault deposit: assetIdx=${assetIdx}, amount=${depositFormatted}`));

        const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
        const tx = await laasContract.deposit(assetIdx, depositAmount, { gasLimit: 500000, gasPrice });
        console.log(chalk.gray(`[Acc ${idx + 1}] LaaS TX Hash: ${tx.hash}`));

        const receipt = await tx.wait();
        console.log(chalk.green(`[Acc ${idx + 1}] ${tokenName} LaaS Vault Deposit confirmed! Block: ${receipt.blockNumber}`));

        return true;
    }, idx, 'dailyTask');
}

async function claimDiscordFaucet(account, idx) {
    if (!account.discordToken) {
        state[idx].discordFaucet = '❌NoTkn';
        state[idx].nextDiscord = getNextDiscordSchedule();
        return false;
    }

    state[idx].discordFaucet = '🔄';
    renderDashboard();

    const client = createDiscordClient(account.discordToken, account.proxy);
    let claimed = 0;
    let total = config.faucets.length;

    for (const faucet of config.faucets) {
        try {
            await sleep(antiDetect.interactionDelay());

            const res = await client.get(`https://discord.com/api/v9/channels/${faucet.channelId}/messages?limit=50`);
            if (res.status !== 200) {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Discord ${faucet.name}: fetch failed (${res.status})`));
                continue;
            }

            const msg = res.data.find(m =>
                m.components?.some(row => row.components?.some(c => c.custom_id === faucet.customId))
            );

            if (!msg) {
                const allButtons = res.data.flatMap(m =>
                    (m.components || []).flatMap(r => (r.components || []).map(c => c.custom_id).filter(Boolean))
                );
                console.log(chalk.gray(`[Acc ${idx + 1}] Discord ${faucet.name}: button '${faucet.customId}' not found. Available: [${allButtons.join(',')}]`));
                continue;
            }

            await sleep(antiDetect.interactionDelay());

            const nonce = ethers.BigNumber.from(Date.now()).mul(1000).toString();
            const payload = {
                type: 3,
                nonce,
                guild_id: config.discordGuildId,
                channel_id: faucet.channelId,
                message_flags: 0,
                message_id: msg.id,
                application_id: config.discordAppId,
                session_id: antiDetect.generateSessionId(),
                data: { component_type: 2, custom_id: faucet.customId }
            };

            const clickRes = await client.post('https://discord.com/api/v9/interactions', payload);
            if (clickRes.status === 204) {
                claimed++;
                console.log(chalk.green(`[Acc ${idx + 1}] ✅ Discord ${faucet.name} faucet claimed!`));
            } else if (clickRes.status === 429) {
                const retryAfter = clickRes.data?.retry_after || 60;
                console.log(chalk.yellow(`[Acc ${idx + 1}] Discord ${faucet.name}: rate limited, wait ${retryAfter}s`));
                await sleep(retryAfter * 1000);
            } else {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Discord ${faucet.name}: click status ${clickRes.status}`));
            }

        } catch (e) {
            const msg = e.response?.status === 403 ? 'forbidden (token issue?)' : e.message?.slice(0, 60);
            console.log(chalk.yellow(`[Acc ${idx + 1}] Discord ${faucet.name}: ${msg}`));
        }

        await sleep(2000 + Math.random() * 3000);
    }

    state[idx].discordFaucet = claimed > 0 ? `✅${claimed}/${total}` : '❌';
    state[idx].lastDiscord = Date.now();
    state[idx].nextDiscord = getNextDiscordSchedule();
    return claimed > 0;
}

function analyzeQuizQuestion(question, options) {
    const q = (question || '').toLowerCase();
    const opts = (options || []).map(o => (o || '').toLowerCase());

    const patterns = [
        { keywords: ['what does liquidity refer', 'liquidity refer'], answer: opts.findIndex(o => o.includes('easily') && o.includes('bought or sold')) },
        { keywords: ['highly liquid market'], answer: opts.findIndex(o => o.includes('tight') && o.includes('spread')) },
        { keywords: ['defi', 'who', 'provides liquidity', 'typically provides'], answer: opts.findIndex(o => o.includes('regular users') || o.includes('liquidity pools')) },
        { keywords: ['powers trading', 'without', 'order book'], answer: opts.findIndex(o => o.includes('automated market') || o.includes('amm')) },
        { keywords: ['not commonly used', 'not', 'measure liquidity'], answer: opts.findIndex(o => o.includes('block') || o.includes('confirmation')) },
        { keywords: ['impermanent loss'], answer: opts.findIndex(o => o.includes('temporary') || o.includes('diverge')) },
        { keywords: ['tvl', 'total value locked'], answer: opts.findIndex(o => o.includes('total') && o.includes('locked')) },
        { keywords: ['slippage'], answer: opts.findIndex(o => o.includes('expected') && o.includes('actual') || o.includes('difference')) },
        { keywords: ['yield farming'], answer: opts.findIndex(o => o.includes('earn') && o.includes('reward') || o.includes('staking')) },
    ];

    for (const p of patterns) {
        if (p.keywords.some(k => q.includes(k)) && p.answer >= 0) {
            return p.answer;
        }
    }

    let bestIdx = 0;
    let bestLen = 0;
    opts.forEach((o, i) => {
        if (o.length > bestLen) { bestLen = o.length; bestIdx = i; }
    });
    return bestIdx;
}

async function fetchS1Quiz(client) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const res = await client.get(`/rest/v1/s1_daily_quiz_content_public`, {
            params: { select: '*', quiz_date: `eq.${today}` }
        });
        
        if (res.data && res.data.length > 0) {
            const quizData = res.data[0];
            console.log(chalk.green(`[QUIZ] ✅ Found quiz for topic: ${quizData.topic || 'Unknown'}`));
            return quizData;
        }
        
        const fallbackRes = await client.get(`/rest/v1/s1_daily_quiz_content_public?select=*&order=created_at.desc&limit=1`);
        if (fallbackRes.data && fallbackRes.data.length > 0) {
            console.log(chalk.yellow(`[QUIZ] Using latest quiz: ${fallbackRes.data[0].topic || 'Unknown'}`));
            return fallbackRes.data[0];
        }
    } catch (e) {
        console.log(chalk.red(`[QUIZ] ❌ Error fetching quiz: ${e.message}`));
    }
    return null;
}

async function checkQuizCompleted(client, addressLower) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const res = await client.get(`/rest/v1/s1_daily_quiz_attempts`, {
            params: {
                select: 'score_percent,liq_earned,correct_count,total_questions,answers',
                wallet_address: `eq.${addressLower}`,
                quiz_date: `eq.${today}`
            }
        });
        
        if (res.data && res.data.length > 0) {
            const attempt = res.data[0];
            console.log(chalk.green(`[QUIZ] ✅ Already completed! Score: ${attempt.score_percent}% (+${attempt.liq_earned} LIQ)`));
            if (attempt.correct_count === attempt.total_questions && attempt.answers) {
                QUIZ_STATE.answers = attempt.answers;
                console.log(chalk.green(`[QUIZ] Loaded correct answers: [${attempt.answers}]`));
            }
            return true;
        }
    } catch {}
    return false;
}

async function processDailyQuiz(account, idx) {
    state[idx].dailyQuiz = '🔄';
    renderDashboard();

    const client = createClient(account.proxy);
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const addressLower = wallet.address.toLowerCase();
    const today = new Date().toISOString().split('T')[0];

    if (QUIZ_STATE.date !== today) {
        QUIZ_STATE.date = today;
        QUIZ_STATE.answers = null;
        QUIZ_STATE.quizData = null;
    }

    const alreadyCompleted = await checkQuizCompleted(client, addressLower);
    if (alreadyCompleted) {
        state[idx].dailyQuiz = '✅';
        return { success: true, result: 'already_done' };
    }

    if (!QUIZ_STATE.quizData) {
        QUIZ_STATE.quizData = await fetchS1Quiz(client);
    }

    if (!QUIZ_STATE.quizData || !QUIZ_STATE.quizData.questions) {
        console.log(chalk.red(`[Acc ${idx + 1}] ❌ No quiz data available`));
        state[idx].dailyQuiz = '❌';
        return { success: false };
    }

    const questions = QUIZ_STATE.quizData.questions;
    console.log(chalk.cyan(`[Acc ${idx + 1}] 📚 Found ${questions.length} quiz questions`));

    let answers = [];

    if (QUIZ_STATE.answers) {
        answers = QUIZ_STATE.answers;
        console.log(chalk.green(`[Acc ${idx + 1}] Using known correct answers: [${answers}]`));
    } else {
        for (let qIndex = 0; qIndex < questions.length; qIndex++) {
            const quizItem = questions[qIndex];
            console.log(chalk.cyan(`\n[Acc ${idx + 1}] 📝 Question ${qIndex + 1}/${questions.length}: ${quizItem.question}`));
            
            let optionsArray = quizItem.options || [];
            optionsArray.forEach((opt, i) => console.log(chalk.gray(`   ${i}: ${opt}`)));

            if (groqClient) {
                try {
                    console.log(chalk.cyan(`[Acc ${idx + 1}] 🤖 Asking Groq...`));
                    const optionsText = optionsArray.map((opt, i) => `${i}: ${opt}`).join('\n');
                    const completion = await groqClient.chat.completions.create({
                        model: config.groqModel,
                        messages: [
                            { role: "system", content: "You are answering a DeFi/liquidity quiz. Return ONLY the number (0-3) of the correct answer. No explanation, just the number." },
                            { role: "user", content: `Question: ${quizItem.question}\nOptions:\n${optionsText}\nWhich option is correct? Return only the number.` }
                        ],
                        temperature: 0.1,
                        max_tokens: 5
                    });
                    const answer = parseInt(completion.choices[0].message.content.trim());
                    if (!isNaN(answer) && answer >= 0 && answer < optionsArray.length) {
                        console.log(chalk.green(`[Acc ${idx + 1}] 🤖 Suggests: ${answer}`));
                        answers.push(answer);
                    } else {
                        const fallback = analyzeQuizQuestion(quizItem.question, optionsArray);
                        console.log(chalk.yellow(`[Acc ${idx + 1}] ⚠️ Groq returned invalid, using analyzer: ${fallback}`));
                        answers.push(fallback);
                    }
                } catch (groqError) {
                    const fallback = analyzeQuizQuestion(quizItem.question, optionsArray);
                    console.log(chalk.yellow(`[Acc ${idx + 1}] ⚠️ Groq error, using analyzer: ${fallback}`));
                    answers.push(fallback);
                }
            } else {
                const answer = analyzeQuizQuestion(quizItem.question, optionsArray);
                console.log(chalk.cyan(`[Acc ${idx + 1}] 📊 Analyzer suggests: ${answer}`));
                answers.push(answer);
            }
            await sleep(2000);
        }
    }

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 📤 Submitting answers: [${answers.join(',')}]`));

    try {
        await sleep(antiDetect.requestJitter());
        
        const res = await client.post('/functions/v1/submit-s1-quiz', 
            {
                wallet_address: addressLower,
                answers: answers
            },
            {
                headers: {
                    'x-wallet-address': addressLower
                }
            }
        );

        console.log(chalk.gray(`[Acc ${idx + 1}] Quiz Response: ${JSON.stringify(res.data)}`));

        if (res.data?.correct_count === res.data?.total_questions) {
            state[idx].dailyQuiz = '✅';
            QUIZ_STATE.answers = answers;
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Quiz PERFECT! ${res.data.correct_count}/${res.data.total_questions} (+${res.data.liq_earned} LIQ)`));
            return { success: true, result: true };
        }

        if (res.data?.correct_count > 0) {
            state[idx].dailyQuiz = '✅';
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Quiz ${res.data.correct_count}/${res.data.total_questions} correct (+${res.data.liq_earned} LIQ)`));
            return { success: true, result: true };
        }

        state[idx].dailyQuiz = '❌';
        return { success: false, error: 'Quiz failed' };

    } catch (e) {
        const errMsg = e.response?.data?.message || e.response?.data?.error || e.message || '';
        if (errMsg.includes('already') || errMsg.includes('completed') || e.response?.status === 400) {
            state[idx].dailyQuiz = '✅';
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Quiz already completed!`));
            return { success: true, result: 'already_done' };
        }
        console.log(chalk.red(`[Acc ${idx + 1}] ❌ Quiz error: ${errMsg}`));
        state[idx].dailyQuiz = '❌';
        return { success: false, error: errMsg };
    }
}

async function processGovernanceVote(account, idx) {
    state[idx].govVote = '🔄';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addressLower = wallet.address.toLowerCase();
    const today = new Date().toISOString().split('T')[0];

    try {
        const voteRes = await client.get(`/rest/v1/s1_governance_votes?wallet_address=eq.${addressLower}&created_at=gte.${today}T00:00:00&select=id`);
        if (voteRes.data && voteRes.data.length >= 5) {
            state[idx].govVote = '✅';
            console.log(chalk.green(`[Acc ${idx + 1}] Already voted ${voteRes.data.length} times today`));
            return { success: true, result: 'already_done' };
        }
        const existingVotes = voteRes.data?.length || 0;
        console.log(chalk.gray(`[Acc ${idx + 1}] Existing votes today: ${existingVotes}/5`));
    } catch (e) {
        console.log(chalk.gray(`[Acc ${idx + 1}] Could not check vote status: ${e.message}`));
    }

    const ROUND_ID = 1;
    const POOLS = [0, 1, 2, 3];
    let voteCount = 0;
    let notEligibleCount = 0;

    const votePlan = [0, 1, 2, POOLS[Math.floor(Math.random() * POOLS.length)], POOLS[Math.floor(Math.random() * POOLS.length)]];

    for (let i = 0; i < votePlan.length; i++) {
        const poolId = votePlan[i];
        const poolName = ['Pool A', 'Pool B', 'Pool C', 'Pool D'][poolId];

        console.log(chalk.cyan(`[Acc ${idx + 1}] Governance vote ${i + 1}/5: Round ${ROUND_ID}, ${poolName}...`));

        const result = await withRetry(async () => {
            const govContract = new ethers.Contract(GOV_ADDR, GOV_ABI, wallet);

            try {
                await govContract.callStatic.vote(ROUND_ID, poolId, 1);
            } catch (simErr) {
                const reason = simErr.reason || simErr.message || '';
                if (reason.includes('already') || reason.includes('voted')) {
                    return 'already_voted';
                }
                if (simErr.data || reason.includes('revert') || reason.includes('CALL_EXCEPTION')) {
                    console.log(chalk.yellow(`[Acc ${idx + 1}] Gov vote rejected: ${reason.slice(0, 80)}`));
                    return 'not_eligible';
                }
                throw simErr;
            }

            const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
            const tx = await govContract.vote(ROUND_ID, poolId, 1, { gasLimit: 300000, gasPrice });
            const receipt = await tx.wait();
            console.log(chalk.green(`[Acc ${idx + 1}] Vote TX confirmed: ${tx.hash.slice(0, 20)}... Block: ${receipt.blockNumber}`));

            await sleep(2000);
            try {
                await client.post('/functions/v1/verify-onchain-task', {
                    wallet_address: addressLower,
                    task_id: 'onchain-first-vote'
                });
            } catch { }

            return true;
        }, idx, 'govVote');

        if (result.success) {
            if (result.result === 'already_voted') {
                console.log(chalk.yellow(`[Acc ${idx + 1}] Already voted this pool`));
            } else if (result.result === 'not_eligible') {
                notEligibleCount++;
                if (notEligibleCount >= 3) {
                    console.log(chalk.yellow(`[Acc ${idx + 1}] Not eligible for any pool, skipping rest`));
                    break;
                }
            } else {
                voteCount++;
            }
        } else {
            console.log(chalk.yellow(`[Acc ${idx + 1}] Vote ${i + 1} failed`));
        }

        await randomSleep();
    }

    const govTasks = ['first-vote', 'active-voter', 'multi-voter', 'daily-activist'];
    for (const taskId of govTasks) {
        try {
            await client.post('/functions/v1/verify-onchain-task', {
                wallet_address: addressLower,
                task_id: taskId
            });
        } catch { }
        await sleep(500);
    }

    state[idx].govVote = voteCount > 0 ? '✅' : '❌';
    console.log(chalk.green(`[Acc ${idx + 1}] Governance: ${voteCount} votes cast`));
    return { success: voteCount > 0, result: voteCount };
}

async function processDailyTasks(account, idx) {
    state[idx].dailyTask = '🔄';
    state[idx].webFaucet = '🔄';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addressLower = wallet.address.toLowerCase();

    try {
        const [profileRes, streakRes] = await Promise.all([
            client.get(`/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addressLower}`),
            client.get(`/rest/v1/s1_checkins?select=checkin_date&wallet_address=eq.${addressLower}&order=checkin_date.desc&limit=50`)
        ]);
        if (profileRes.data?.[0]) state[idx].points = profileRes.data[0].s1_liq_earned || 0;
        if (streakRes.data && streakRes.data.length > 0) {
            let streak = 1;
            const dates = streakRes.data.map(d => d.checkin_date);
            for (let i = 1; i < dates.length; i++) {
                const prev = new Date(dates[i - 1]);
                const curr = new Date(dates[i]);
                const diffDays = (prev - curr) / (1000 * 60 * 60 * 24);
                if (diffDays === 1) streak++;
                else break;
            }
            state[idx].streak = streak;
        }
    } catch { }
    renderDashboard();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 💧 Web Faucets:`));
    const usdcResult = await claimWebFaucet(wallet, USDC_ADDR, idx);
    await randomSleep();
    const usdtResult = await claimWebFaucet(wallet, USDT_ADDR, idx);

    state[idx].webFaucet = (usdcResult.success || usdtResult.success) ? '✅' : '⏳CD';
    renderDashboard();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 📅 Daily Check-in:`));
    const checkinResult = await withRetry(async () => {
        const res = await client.post('/functions/v1/s1-checkin', {}, {
            headers: { 'x-wallet-address': addressLower }
        });
        console.log(chalk.gray(`[Acc ${idx + 1}] S1 Check-in response: ${JSON.stringify(res.data)}`));
        if (res.data?.success || res.data?.checkin_date || res.data?.liq_awarded) return true;
        if (res.data?.already_checked_in) return true;
        if (res.data?.message?.includes('already') || res.data?.error?.includes('already')) return true;
        throw new Error(res.data?.message || res.data?.error || 'Check-in failed');
    }, idx, 'dailyTask');

    await randomSleep();

    const usdcBal = await getTokenBalance(wallet, USDC_ADDR);
    const usdtBal = await getTokenBalance(wallet, USDT_ADDR);
    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 💰 Current Balances:`));
    console.log(chalk.gray(`   tUSDC: ${ethers.utils.formatUnits(usdcBal, 6)}`));
    console.log(chalk.gray(`   tUSDT: ${ethers.utils.formatUnits(usdtBal, 18)}`));

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 🏦 RLP Vault Deposits:`));

    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing 1000 tUSDC to RLP Vault...`));
    const usdcDepositResult = await depositVault(wallet, 1, idx, 1000, true);
    console.log(chalk.gray(`[Acc ${idx + 1}] USDC Deposit result: ${JSON.stringify(usdcDepositResult)}`));

    if (usdcDepositResult.success && usdcDepositResult.result !== 'skip_insufficient') {
        await sleep(5000);

        const verifyUsdcResult = await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-deposit-tusdc-1000',
                token_type: 'tusdc'
            });
            console.log(chalk.gray(`[Acc ${idx + 1}] USDC Verify response: ${JSON.stringify(res.data)}`));
            if (res.data?.verified || res.data?.success || res.data?.message?.includes('already')) return true;
            throw new Error(res.data?.message || 'USDC verification failed');
        }, idx, 'dailyTask');
        console.log(chalk.green(`[Acc ${idx + 1}] USDC deposit verified: ${verifyUsdcResult.success}`));
    } else {
        console.log(chalk.yellow(`[Acc ${idx + 1}] USDC deposit skipped (insufficient balance)`));
    }

    await randomSleep();

    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing 1000 tUSDT to RLP Vault...`));
    const usdtDepositResult = await depositVault(wallet, 0, idx, 1000, true);
    console.log(chalk.gray(`[Acc ${idx + 1}] USDT Deposit result: ${JSON.stringify(usdtDepositResult)}`));

    if (usdtDepositResult.success && usdtDepositResult.result !== 'skip_insufficient') {
        await sleep(5000);

        const verifyUsdtResult = await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-deposit-tusdt-1000',
                token_type: 'tusdt'
            });
            console.log(chalk.gray(`[Acc ${idx + 1}] USDT Verify response: ${JSON.stringify(res.data)}`));
            if (res.data?.verified || res.data?.success || res.data?.message?.includes('already')) return true;
            throw new Error(res.data?.message || 'USDT verification failed');
        }, idx, 'dailyTask');
        console.log(chalk.green(`[Acc ${idx + 1}] USDT deposit verified: ${verifyUsdtResult.success}`));
    } else {
        console.log(chalk.yellow(`[Acc ${idx + 1}] USDT deposit skipped (insufficient balance)`));
    }

    await randomSleep();

    console.log(chalk.cyan(`\n[Acc ${idx + 1}] 🏛️ LaaS Vault Deposits:`));

    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing 500 tUSDC to LaaS Vault...`));
    const laasUsdcResult = await depositLaaSVault(wallet, 1, idx, 500, true);
    console.log(chalk.gray(`[Acc ${idx + 1}] LaaS USDC Deposit result: ${JSON.stringify(laasUsdcResult)}`));

    if (laasUsdcResult.success && laasUsdcResult.result !== 'skip_insufficient') {
        await sleep(5000);

        const verifyLaasUsdcResult = await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-laas-deposit-tusdc',
                token_type: 'tusdc'
            });
            console.log(chalk.gray(`[Acc ${idx + 1}] LaaS USDC Verify response: ${JSON.stringify(res.data)}`));
            if (res.data?.verified || res.data?.success || res.data?.message?.includes('already')) return true;
            throw new Error(res.data?.message || 'LaaS USDC verification failed');
        }, idx, 'dailyTask');
        console.log(chalk.green(`[Acc ${idx + 1}] LaaS USDC deposit verified: ${verifyLaasUsdcResult.success}`));
    } else {
        console.log(chalk.yellow(`[Acc ${idx + 1}] LaaS USDC deposit skipped (insufficient balance)`));
    }

    await randomSleep();

    console.log(chalk.cyan(`[Acc ${idx + 1}] Depositing 500 tUSDT to LaaS Vault...`));
    const laasUsdtResult = await depositLaaSVault(wallet, 0, idx, 500, true);
    console.log(chalk.gray(`[Acc ${idx + 1}] LaaS USDT Deposit result: ${JSON.stringify(laasUsdtResult)}`));

    if (laasUsdtResult.success && laasUsdtResult.result !== 'skip_insufficient') {
        await sleep(5000);

        const verifyLaasUsdtResult = await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-laas-deposit-tusdt',
                token_type: 'tusdt'
            });
            console.log(chalk.gray(`[Acc ${idx + 1}] LaaS USDT Verify response: ${JSON.stringify(res.data)}`));
            if (res.data?.verified || res.data?.success || res.data?.message?.includes('already')) return true;
            throw new Error(res.data?.message || 'LaaS USDT verification failed');
        }, idx, 'dailyTask');
        console.log(chalk.green(`[Acc ${idx + 1}] LaaS USDT deposit verified: ${verifyLaasUsdtResult.success}`));
    } else {
        console.log(chalk.yellow(`[Acc ${idx + 1}] LaaS USDT deposit skipped (insufficient balance)`));
    }

    await randomSleep();

    await withRetry(async () => {
        const res = await client.post('/functions/v1/verify-onchain-task', {
            wallet_address: addressLower,
            task_id: 'daily-duel-create'
        });
        console.log(chalk.gray(`[Acc ${idx + 1}] Duel task verify: ${JSON.stringify(res.data)}`));
        return res.data?.verified;
    }, idx, 'dailyTask');
    await randomSleep();

    await processDailyQuiz(account, idx);
    await randomSleep();

    await processGovernanceVote(account, idx);
    await randomSleep();

    try {
        const [profileRes, streakRes] = await Promise.all([
            client.get(`/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addressLower}`),
            client.get(`/rest/v1/s1_checkins?select=checkin_date&wallet_address=eq.${addressLower}&order=checkin_date.desc&limit=50`)
        ]);
        if (profileRes.data?.[0]) state[idx].points = profileRes.data[0].s1_liq_earned || 0;
        if (streakRes.data && streakRes.data.length > 0) {
            let streak = 1;
            const dates = streakRes.data.map(d => d.checkin_date);
            for (let i = 1; i < dates.length; i++) {
                const prev = new Date(dates[i - 1]);
                const curr = new Date(dates[i]);
                const diffDays = (prev - curr) / (1000 * 60 * 60 * 24);
                if (diffDays === 1) streak++;
                else break;
            }
            state[idx].streak = streak;
        }
    } catch { }

    state[idx].dailyTask = checkinResult.success ? '✅' : '❌';
    state[idx].lastDaily = Date.now();
    state[idx].nextDaily = getNextDailySchedule();
}

async function getOpenDuels(wallet) {
    try {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        const duels = await contract.getOpenDuels();
        return duels
            .filter(d => d.challenger.toLowerCase() !== wallet.address.toLowerCase())
            .map(d => ({
                id: d.id.toNumber(),
                challenger: d.challenger,
                opponent: d.opponent,
                wagerAmount: d.wagerAmount,
                wagerToken: d.wagerToken,
                duelType: d.duelType,
                status: d.status
            }));
    } catch { return []; }
}

async function getDuelById(wallet, duelId) {
    try {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        const duel = await contract.getDuel(duelId);
        if (!duel.challenger || duel.challenger === ethers.constants.AddressZero) return null;
        return {
            id: duel.id.toNumber(),
            challenger: duel.challenger,
            opponent: duel.opponent,
            wagerAmount: duel.wagerAmount,
            wagerToken: duel.wagerToken,
            duelType: duel.duelType,
            status: duel.status,
            winner: duel.winner,
            prizeClaimed: duel.prizeClaimed,
            createdAt: duel.createdAt
        };
    } catch { return null; }
}

async function findClaimableDuels(wallet) {
    try {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        const userDuelIds = await contract.getUserDuels(wallet.address);
        const claimable = [];

        for (const duelIdBN of userDuelIds.slice(-20)) {
            const duel = await getDuelById(wallet, duelIdBN.toNumber());
            if (duel && duel.status === DUEL_STATUS.RESOLVED &&
                duel.winner.toLowerCase() === wallet.address.toLowerCase() &&
                !duel.prizeClaimed) {
                claimable.push(duel);
            }
        }
        return claimable;
    } catch { return []; }
}

async function processDuel(account, idx) {
    state[idx].duelStatus = '🔄';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addressLower = wallet.address.toLowerCase();

    if (account.duelEnabled === false) {
        state[idx].duelStatus = '⛔ Off';
        state[idx].nextDuel = getNextDiscordSchedule();
        return;
    }

    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);

    state[idx].duelHistory = state[idx].duelHistory.filter(h => h.timestamp > today);
    state[idx].dailyDuelCount = state[idx].duelHistory.length;

    const isLimitReached = state[idx].dailyDuelCount >= DAILY_DUEL_LIMIT;

    if (isLimitReached) {
        state[idx].duelStatus = '✅Limit';
        state[idx].nextDuel = getNextDailySchedule();
        console.log(chalk.green(`[Acc ${idx + 1}] 🏁 Daily Target Reached! (Duels: ${state[idx].dailyDuelCount}/1)`));
        return;
    }

    const recentDuels = state[idx].duelHistory.filter(h => now - h.timestamp < RATE_LIMIT_WINDOW);
    if (recentDuels.length >= RATE_LIMIT_DUELS) {
        state[idx].duelStatus = '⏳Rate';
        state[idx].nextDuel = new Date(Date.now() + RATE_LIMIT_WINDOW);
        return;
    }

    await withRetry(async () => {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        try {
            await contract.callStatic.claimAllPrizes();
            const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
            const tx = await contract.claimAllPrizes({ gasLimit: 500000, gasPrice });
            await tx.wait();
            console.log(chalk.green(`[Acc ${idx + 1}] All prizes claimed!`));
        } catch (e) {
            if (e.reason?.includes('nothing') || e.message?.includes('nothing')) {
                console.log(chalk.gray(`[Acc ${idx + 1}] No prizes to claim`));
            } else {
                throw e;
            }
        }
        return true;
    }, idx, 'duelStatus');
    await randomSleep();

    await withRetry(async () => {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        try {
            await contract.callStatic.claimAllRefunds();
            const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
            const tx = await contract.claimAllRefunds({ gasLimit: 500000, gasPrice });
            await tx.wait();
            console.log(chalk.green(`[Acc ${idx + 1}] All refunds claimed!`));
        } catch { }
        return true;
    }, idx, 'duelStatus');

    console.log(chalk.cyan(`[Acc ${idx + 1}] ⚔️ Daily Duel Strategy: Try Join 3x -> Fallback Create...`));

    let duelCompleted = false;
    let joinAttempts = 0;
    const MAX_JOIN_ATTEMPTS = 3;

    const openDuels = await getOpenDuels(wallet);
    console.log(chalk.gray(`[Acc ${idx + 1}] 🔍 Found ${openDuels.length} open duels`));

    openDuels.sort((a, b) => {
        const aDecimals = a.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase() ? 6 : 18;
        const bDecimals = b.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase() ? 6 : 18;
        const aAmt = parseFloat(ethers.utils.formatUnits(a.wagerAmount, aDecimals));
        const bAmt = parseFloat(ethers.utils.formatUnits(b.wagerAmount, bDecimals));
        return aAmt - bAmt;
    });

    for (const duel of openDuels) {
        if (duelCompleted) break;
        if (joinAttempts >= MAX_JOIN_ATTEMPTS) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] ⚠️ Reached max join attempts (${MAX_JOIN_ATTEMPTS}). Switching to Create Mode...`));
            break;
        }

        const isUSDC = duel.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase();
        const tokenAddr = isUSDC ? USDC_ADDR : USDT_ADDR;
        const decimals = isUSDC ? 6 : 18;
        const amount = parseFloat(ethers.utils.formatUnits(duel.wagerAmount, decimals));

        if (amount > 2000) continue;

        const balance = await getTokenBalance(wallet, tokenAddr);
        if (balance.lt(duel.wagerAmount)) {
            console.log(chalk.yellow(`[Acc ${idx + 1}] ⚠️ Insufficient balance to join duel #${duel.id} (${amount} ${isUSDC ? 'USDC' : 'USDT'}).`));
            continue;
        }

        const opponentCount = state[idx].duelHistory.filter(h => h.opponent.toLowerCase() === duel.challenger.toLowerCase()).length;
        if (opponentCount >= SAME_OPPONENT_LIMIT) continue;

        console.log(chalk.cyan(`[Acc ${idx + 1}] 🎯 Attempting join duel #${duel.id} (${amount} ${isUSDC ? 'USDC' : 'USDT'})...`));
        joinAttempts++;

        const result = await withRetry(async () => {
            const approved = await ensureApproval(wallet, tokenAddr, DUEL_ADDR);
            if (!approved) throw new Error('Approval failed');
            const iface = new ethers.utils.Interface(DUEL_ABI);
            const data = iface.encodeFunctionData('acceptDuel', [duel.id]);

            try {
                const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
                await contract.callStatic.acceptDuel(duel.id);
            } catch (simError) {
                console.log(chalk.yellow(`[Acc ${idx + 1}] ⚠️ Join Simulation failed for duel #${duel.id} (Likely taken or Daily Limit Reached).`));
                return false;
            }

            const gasPrice = (await provider.getGasPrice()).mul(110).div(100);
            try {
                const tx = await wallet.sendTransaction({ to: DUEL_ADDR, data, gasLimit: 1000000, gasPrice });
                await tx.wait();
                return true;
            } catch (txError) {
                console.log(chalk.red(`[Acc ${idx + 1}] ❌ Duel Join TX Failed: ${txError.reason || txError.message}`));
                throw txError;
            }
        }, idx, 'duelStatus');

        if (result.success && result.result === true) {
            duelCompleted = true;
            state[idx].duelHistory.push({ timestamp: Date.now(), opponent: duel.challenger, amount: amount });
            console.log(chalk.green(`[Acc ${idx + 1}] ✅ Duel accepted! Waiting for resolution...`));
        }
    }

    if (!duelCompleted) {
        if (openDuels.length > 0 && joinAttempts < MAX_JOIN_ATTEMPTS) {
        }

        console.log(chalk.cyan(`[Acc ${idx + 1}] 🆕 Switching to CREATE DUEL Mode (Fallback)...`));

        const useUSDC = Math.random() < 0.5;
        const tokenAddr = useUSDC ? USDC_ADDR : USDT_ADDR;
        const decimals = useUSDC ? 6 : 18;
        const balance = await getTokenBalance(wallet, tokenAddr);
        const minWager = ethers.utils.parseUnits("10", decimals);

        if (balance.gte(minWager)) {
            for (let createAttempt = 1; createAttempt <= 3; createAttempt++) {
                if (duelCompleted) break;

                const rawAmount = randomDelay(10, 100);
                const wagerAmount = ethers.utils.parseUnits(rawAmount.toString(), decimals);

                console.log(chalk.cyan(`[Acc ${idx + 1}] 🗡️ Creating duel (Attempt ${createAttempt}/3) - ${rawAmount} ${useUSDC ? 'USDC' : 'USDT'}...`));

                const result = await withRetry(async () => {
                    const approved = await ensureApproval(wallet, tokenAddr, DUEL_ADDR);
                    if (!approved) throw new Error('Approval failed');
                    const iface = new ethers.utils.Interface(DUEL_ABI);
                    const data = iface.encodeFunctionData('createDuel', [wagerAmount, tokenAddr, 0]);

                    try {
                        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
                        await contract.callStatic.createDuel(wagerAmount, tokenAddr, 0);
                    } catch (simError) {
                        console.log(chalk.red(`[Acc ${idx + 1}] ⚠️ Create Simulation failed (Likely Daily Limit Reached). Stopping...`));
                        return 'SIMULATION_FAILED';
                    }

                    const gasPrice = (await provider.getGasPrice()).mul(110).div(100);

                    try {
                        const tx = await wallet.sendTransaction({ to: DUEL_ADDR, data, gasLimit: 1000000, gasPrice });
                        await tx.wait();
                        return true;
                    } catch (txError) {
                        console.log(chalk.red(`[Acc ${idx + 1}] ❌ Create TX Failed: ${txError.reason || txError.message}`));
                        throw txError;
                    }
                }, idx, 'duelStatus');

                if (result === 'SIMULATION_FAILED') {
                    state[idx].duelStatus = '✅Limit';
                    duelCompleted = false;
                    break;
                }

                if (result && result.success && result.result === true) {
                    duelCompleted = true;
                    state[idx].duelHistory.push({ timestamp: Date.now(), opponent: 'unknown_created', amount: rawAmount });
                    console.log(chalk.green(`[Acc ${idx + 1}] ✅ Duel created! Waiting for opponent...`));
                } else {
                    await sleep(3000);
                }
            }
        } else {
            console.log(chalk.yellow(`[Acc ${idx + 1}] ⚠️ Insufficient balance to create duel (Needed: ~400 ${useUSDC ? 'USDC' : 'USDT'}).`));
        }
    }

    console.log(chalk.gray(`[Acc ${idx + 1}] 📅 Daily duel result: ${duelCompleted ? 'Success' : 'Failed'}`));

    const { dailyDuelCount } = state[idx];
    if (dailyDuelCount >= DAILY_DUEL_LIMIT) {
        state[idx].duelStatus = '✅Limit';
        state[idx].nextDuel = getNextDailySchedule();
        return;
    }

    if (!duelCompleted) {
        state[idx].duelFailures++;
        state[idx].duelStatus = '❌Fail';
        state[idx].nextDuel = new Date(Date.now() + 4 * 60 * 60 * 1000);
        console.log(chalk.yellow(`[Acc ${idx + 1}] ⏳ Duel failed today. Retrying in 4 hours.`));
        return;
    }

    const reserve = randomDelay(100, 500);
    await depositVault(wallet, 1, idx, reserve);
    await depositVault(wallet, 0, idx, reserve);

    await withRetry(async () => {
        const res = await client.post('/functions/v1/verify-onchain-task', {
            wallet_address: addressLower,
            task_id: 'daily-duelist'
        });
        return res.data?.verified;
    }, idx, 'duelStatus');

    state[idx].duelStatus = '✅';
    state[idx].lastDuel = Date.now();
    state[idx].nextDuel = new Date(Date.now() + randomDelay(10000, 30000));
}

async function syncDailyStats(account, idx) {
    state[idx].duelStatus = '🔄Sync';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const today = new Date().setHours(0, 0, 0, 0);

    try {
        const contract = new ethers.Contract(DUEL_ADDR, DUEL_ABI, wallet);
        const userDuelIds = await contract.getUserDuels(wallet.address);

        const recentIds = userDuelIds.slice(-20);
        const history = [];

        for (const idBN of recentIds) {
            const duel = await getDuelById(wallet, idBN.toNumber());
            if (duel && duel.createdAt * 1000 > today) {
                const isUSDC = duel.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase();
                const decimals = isUSDC ? 6 : 18;
                const amount = parseFloat(ethers.utils.formatUnits(duel.wagerAmount, decimals));

                history.push({
                    timestamp: duel.createdAt * 1000,
                    opponent: duel.opponent.toLowerCase() === wallet.address.toLowerCase() ? duel.challenger : duel.opponent,
                    amount: amount
                });
            }
        }

        state[idx].duelHistory = history;
        state[idx].dailyDuelCount = history.length;

        const isLimitReached = state[idx].dailyDuelCount >= DAILY_DUEL_LIMIT;

        state[idx].duelStatus = isLimitReached ? '✅Limit' : '⏳';

        if (state[idx].duelStatus.startsWith('✅')) {
            state[idx].nextDuel = getNextDailySchedule();
        }

        console.log(chalk.blue(`[Acc ${idx + 1}] 🔄 Synced: ${state[idx].dailyDuelCount} duels.`));

    } catch (e) {
        console.log(chalk.red(`[Acc ${idx + 1}] ❌ Sync Failed: ${e.message}`));
    }
}

async function main() {
    accounts.forEach((_, i) => {
        state[i] = createState(i);
        state[i].nextDaily = new Date(Date.now() - 60000);
        state[i].nextDuel = new Date(Date.now() + randomDelay(5000, 30000));
        state[i].nextDiscord = new Date(Date.now() + randomDelay(5000, 30000));
    });

    renderDashboard();

    console.log(chalk.yellow('🔄 Syncing daily stats from blockchain...'));
    for (let i = 0; i < accounts.length; i++) {
        await syncDailyStats(accounts[i], i);
    }
    console.log(chalk.green('✅ Sync complete. Starting main loop...'));
    await sleep(2000);

    renderDashboard();

    while (true) {
        const now = Date.now();

        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            const s = state[i];

            if (s.isProcessing) continue;

            if (s.nextDaily && now >= s.nextDaily.getTime()) {
                s.isProcessing = true;
                try {
                    await processDailyTasks(acc, i);
                } catch (e) {
                    logError(i, `Daily: ${e.message?.slice(0, 50)}`);
                    s.dailyTask = '❌';
                }
                s.isProcessing = false;
                s.nextDaily = getNextDailySchedule();
                renderDashboard();
            }

            const discordDue = s.lastDiscord === 0 || (now - s.lastDiscord >= config.discordInterval);
            if (acc.discordToken && discordDue && !s.isProcessing) {
                s.isProcessing = true;
                try {
                    await claimDiscordFaucet(acc, i);
                } catch (e) {
                    logError(i, `Discord: ${e.message?.slice(0, 50)}`);
                    s.discordFaucet = '❌';
                }
                s.isProcessing = false;
                renderDashboard();
            }

            if (s.nextDuel && now >= s.nextDuel.getTime() && !s.isProcessing) {
                s.isProcessing = true;
                try {
                    await processDuel(acc, i);
                } catch (e) {
                    logError(i, `Duel: ${e.message?.slice(0, 50)}`);
                    s.duelStatus = '❌';
                }
                s.isProcessing = false;
                renderDashboard();
            }
        }

        renderDashboard();
        await sleep(1000);
    }
}

process.on('SIGINT', () => {
    clearScreen();
    console.log(chalk.yellow('\n👋 Bot stopped gracefully. Goodbye!'));
    process.exit(0);
});

main().catch(e => {
    console.error(chalk.red('Fatal error:'), e);
    process.exit(1);
});