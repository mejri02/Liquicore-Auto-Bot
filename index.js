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
    dailyHour: 21,
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
    } catch (e) {
        console.log(chalk.yellow('⚠️ config.json not found, using default settings'));
    }
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
    } catch (e) {
        console.log(chalk.yellow(`⚠️ Groq initialization failed: ${e.message}`));
    }
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

// S1 Contract Addresses
const USDC_ADDR = '0xaD88B079712CC38a8D33E072CB6434E652556441'; // S1-tUSDC (6 decimals)
const USDT_ADDR = '0x5c0d9bb86b99168Aa8A36fad84d068d258c259a5'; // S1-tUSDT (18 decimals)
const VAULT_ADDR = '0xC044428E4f0b46C9897730fc9137806Ed8deBB9d'; // S1 RLP Vault
const LAAS_VAULT_ADDR = '0xB8332cfE7DddD45CEcAADA6C0e564b09AbBb5744'; // S1 LaaS Vault
const DUEL_ADDR = '0xFbB6a304e361AE93B33A87a3700CC1CF1b2bAc8c';

const DAILY_DUEL_LIMIT = 1;
const SAME_OPPONENT_LIMIT = 3;
const RATE_LIMIT_DUELS = 3;
const RATE_LIMIT_WINDOW = 2 * 60 * 1000;

const DUEL_ABI = [
    'function createDuel(uint256 wagerAmount, address wagerToken, uint8 duelType) returns (uint256)',
    'function acceptDuel(uint256 duelId)',
    'function claimPrize(uint256 duelId)',
    'function duels(uint256) view returns (uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed)',
    'function duelCounter() view returns (uint256)',
    'function getOpenDuels() view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed)[])',
    'function getUserDuels(address user) view returns (uint256[])',
    'function getDuel(uint256 duelId) view returns (tuple(uint256 id, address challenger, address opponent, uint256 wagerAmount, address wagerToken, uint8 duelType, uint8 status, uint256 createdAt, uint256 expiresAt, address winner, bool prizeClaimed))'
];

const DUEL_STATUS = { PENDING: 0, ACTIVE: 1, RESOLVED: 2, CLAIMED: 3, CANCELLED: 4 };

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

function getNextDuelSchedule() {
    return new Date(Date.now() + randomDelay(config.duelInterval, config.duelInterval + 300000));
}

function logError(idx, msg, rawError = null) {
    const time = moment().format('HH:mm:ss');
    const logMsg = `[${time}] [Acc ${idx + 1}] ❌ ${msg}`;
    errorLogs.push(logMsg);
    if (errorLogs.length > MAX_ERROR_LOGS) errorLogs.shift();
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
    ║     🔷 MEJRI02 LIQUICORE BOT 🔷     ║
    ║    Version 5.0 - Complete Timers     ║
    ╚══════════════════════════════════════╝
`);

function clearScreen() {
    process.stdout.write('\x1B[2J\x1B[0f');
}

function renderDashboard() {
    clearScreen();
    process.stdout.write('\x1B[1;1H');

    console.log(BANNER);
    console.log(chalk.gray('═'.repeat(80)));
    
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
        console.log(`  ${chalk.red('⚔️ Duel')}       : ${formatStatus(s.duelStatus)}`);
        console.log(`  ${chalk.gray('⏰ NextDiscord')} : ${nextDiscord}`);
        console.log(`  ${chalk.gray('⏰ NextDaily')}   : ${nextDaily}`);
        console.log(`  ${chalk.gray('⏰ NextDuel')}    : ${nextDuel}`);
    });
    
    if (errorLogs.length > 0) {
        console.log(chalk.red.bold('\n⚠️  Error Logs:'));
        errorLogs.slice(-3).forEach(log => console.log(chalk.red(`  ${log}`)));
    }
    
    console.log(chalk.gray('\n' + '═'.repeat(80)));
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
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'Accept-Profile': 'public',
            'origin': config.origin,
            'referer': config.referer,
            'user-agent': userAgent
        }
    });
}

function createDiscordClient(token, proxy) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    return axios.create({
        timeout: 30000,
        httpsAgent: agent,
        headers: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': antiDetect.getRandomUA()
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
    const minAllowance = ethers.utils.parseUnits("1000000", 18);
    const allowance = await getAllowance(wallet, tokenAddress, spender);
    const tokenName = tokenAddress === USDC_ADDR ? 'USDC' : 'USDT';
    
    if (allowance.gte(minAllowance)) {
        console.log(chalk.gray(`   ✅ ${tokenName} already approved`));
        return true;
    }

    try {
        console.log(chalk.cyan(`   🔄 Approving ${tokenName}...`));
        const data = '0x095ea7b3' + '000000000000000000000000' + spender.slice(2).toLowerCase() + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
        const tx = await wallet.sendTransaction({ to: tokenAddress, data, gasLimit: 200000, gasPrice });
        console.log(chalk.gray(`   📤 Approval TX: ${tx.hash}`));
        await tx.wait();
        console.log(chalk.green(`   ✅ ${tokenName} approved`));
        return true;
    } catch (e) {
        console.log(chalk.red(`   ❌ Approval Error: ${e.reason || e.message}`));
        return false;
    }
}

async function claimWebFaucet(wallet, tokenAddress, idx) {
    return await withRetry(async () => {
        const S1_FAUCET_ABI = [
            'function claimFaucet() external',
            'function canClaim(address) view returns (bool)'
        ];

        const contract = new ethers.Contract(tokenAddress, S1_FAUCET_ABI, wallet);

        try {
            const canClaim = await contract.canClaim(wallet.address);
            if (!canClaim) {
                console.log(chalk.yellow(`   ⏭️ Faucet not claimable yet`));
                return 'already_done';
            }
        } catch { }

        const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
        const tx = await contract.claimFaucet({ gasLimit: 200000, gasPrice });
        console.log(chalk.gray(`   📤 Faucet TX: ${tx.hash}`));
        await tx.wait();
        console.log(chalk.green(`   ✅ Faucet claimed!`));
        return true;
    }, idx, 'webFaucet');
}

async function depositVault(wallet, type, idx, amount = 1000) {
    const tokenAddr = type === 1 ? USDC_ADDR : USDT_ADDR;
    const tokenName = type === 1 ? 'tUSDC' : 'tUSDT';
    const decimals = type === 1 ? 6 : 18;

    console.log(chalk.cyan(`   🔍 Checking ${tokenName} balance...`));
    const bal = await getTokenBalance(wallet, tokenAddr);
    const balFormatted = ethers.utils.formatUnits(bal, decimals);
    console.log(chalk.gray(`   💰 ${tokenName} Balance: ${balFormatted}`));

    const depositAmount = ethers.utils.parseUnits(amount.toString(), decimals);
    
    if (bal.lt(depositAmount)) {
        console.log(chalk.yellow(`   ⏭️ Insufficient ${tokenName}: need ${amount}, have ${balFormatted}`));
        return { success: false, skipped: true, result: 'skip_insufficient' };
    }

    console.log(chalk.cyan(`   🔍 Checking allowance...`));
    const allowance = await getAllowance(wallet, tokenAddr, VAULT_ADDR);
    const allowanceFormatted = ethers.utils.formatUnits(allowance, decimals);
    console.log(chalk.gray(`   📊 Allowance: ${allowanceFormatted}`));

    if (allowance.lt(depositAmount)) {
        console.log(chalk.cyan(`   🔄 Approval needed...`));
        const approved = await ensureApproval(wallet, tokenAddr, VAULT_ADDR);
        if (!approved) {
            console.log(chalk.yellow(`   ⏭️ Approval failed`));
            return { success: false, skipped: true };
        }
    }

    return await withRetry(async () => {
        const VAULT_ABI = ['function deposit(uint8 assetIdx, uint256 amount, uint8 tierIndex)'];
        const vaultContract = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);

        console.log(chalk.cyan(`   📤 Sending deposit...`));
        const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
        
        const tx = await vaultContract.deposit(type, depositAmount, 0, { 
            gasLimit: 500000, 
            gasPrice
        });
        console.log(chalk.gray(`   📤 TX: ${tx.hash}`));
        await tx.wait();
        console.log(chalk.green(`   ✅ Deposit confirmed`));
        return { success: true, result: true };
    }, idx, 'dailyTask');
}

async function depositLaaSVault(wallet, assetIdx, idx, amount = 500) {
    const tokenAddr = assetIdx === 1 ? USDC_ADDR : USDT_ADDR;
    const tokenName = assetIdx === 1 ? 'tUSDC' : 'tUSDT';
    const decimals = assetIdx === 1 ? 6 : 18;

    console.log(chalk.cyan(`   🔍 Checking ${tokenName} balance...`));
    const bal = await getTokenBalance(wallet, tokenAddr);
    const balFormatted = ethers.utils.formatUnits(bal, decimals);
    console.log(chalk.gray(`   💰 ${tokenName} Balance: ${balFormatted}`));

    const depositAmount = ethers.utils.parseUnits(amount.toString(), decimals);
    
    if (bal.lt(depositAmount)) {
        console.log(chalk.yellow(`   ⏭️ Insufficient ${tokenName}: need ${amount}, have ${balFormatted}`));
        return { success: false, skipped: true, result: 'skip_insufficient' };
    }

    return await withRetry(async () => {
        console.log(chalk.cyan(`   🔍 Checking allowance...`));
        const allowance = await getAllowance(wallet, tokenAddr, LAAS_VAULT_ADDR);
        const allowanceFormatted = ethers.utils.formatUnits(allowance, decimals);
        console.log(chalk.gray(`   📊 Allowance: ${allowanceFormatted}`));
        
        if (allowance.lt(depositAmount)) {
            console.log(chalk.cyan(`   🔄 Approval needed...`));
            const approved = await ensureApproval(wallet, tokenAddr, LAAS_VAULT_ADDR);
            if (!approved) {
                console.log(chalk.yellow(`   ⏭️ Approval failed`));
                return { success: false, skipped: true };
            }
        }

        const LAAS_ABI = ['function deposit(uint8 assetIdx, uint256 amount)'];
        const laasContract = new ethers.Contract(LAAS_VAULT_ADDR, LAAS_ABI, wallet);

        console.log(chalk.cyan(`   📤 Sending LaaS deposit...`));
        const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
        const tx = await laasContract.deposit(assetIdx, depositAmount, { gasLimit: 500000, gasPrice });
        console.log(chalk.gray(`   📤 TX: ${tx.hash}`));
        await tx.wait();
        console.log(chalk.green(`   ✅ LaaS deposit confirmed`));
        return { success: true, result: true };
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

    for (const faucet of config.faucets) {
        const result = await withRetry(async () => {
            await sleep(antiDetect.interactionDelay());

            const res = await client.get(`https://discord.com/api/v9/channels/${faucet.channelId}/messages?limit=10`);
            
            const msg = res.data.find(m =>
                m.author.id === config.discordAppId &&
                m.components?.some(row => row.components?.some(c => c.custom_id === faucet.customId))
            );

            if (!msg) return false;

            await sleep(antiDetect.interactionDelay());

            const nonce = ethers.BigNumber.from(Date.now()).mul(1000).toString();
            const payload = {
                type: 3,
                guild_id: config.discordGuildId,
                channel_id: faucet.channelId,
                message_id: msg.id,
                application_id: config.discordAppId,
                session_id: antiDetect.generateSessionId(),
                nonce,
                data: { component_type: 2, custom_id: faucet.customId }
            };

            const clickRes = await client.post('https://discord.com/api/v9/interactions', payload);
            
            if (clickRes.status === 204) {
                console.log(chalk.green(`   ✅ ${faucet.name} claimed`));
                return true;
            }
            if (clickRes.status === 429) {
                const retryAfter = clickRes.data.retry_after || 60;
                await sleep(retryAfter * 1000);
                throw new Error('Rate limited');
            }
            return false;
        }, idx, 'discordFaucet');

        if (result.success && result.result === true) claimed++;
        await randomSleep();
    }

    state[idx].discordFaucet = claimed > 0 ? '✅' : '❌';
    state[idx].lastDiscord = Date.now();
    state[idx].nextDiscord = getNextDiscordSchedule();
    return claimed > 0;
}

async function fetchQuiz(client) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const res = await client.get(`/rest/v1/s1_daily_quiz_content_public`, {
            params: { select: '*', quiz_date: `eq.${today}` }
        });
        
        if (res.data && res.data.length > 0) {
            const quizData = res.data[0];
            console.log(chalk.green(`   ✅ Quiz found for topic: ${quizData.topic || 'Unknown'}`));
            return quizData;
        }
    } catch (e) {
        console.log(chalk.red(`   ❌ Error fetching quiz: ${e.message}`));
    }
    return null;
}

async function checkQuizCompleted(client, addressLower) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const res = await client.get(`/rest/v1/s1_daily_quiz_attempts`, {
            params: {
                select: 'score_percent,liq_earned,correct_count,total_questions',
                wallet_address: `eq.${addressLower}`,
                quiz_date: `eq.${today}`
            }
        });
        
        if (res.data && res.data.length > 0) {
            const attempt = res.data[0];
            console.log(chalk.green(`   ✅ Quiz already completed! Score: ${attempt.score_percent}%`));
            return true;
        }
    } catch {}
    return false;
}

async function processDailyQuiz(account, idx) {
    console.log(chalk.cyan(`\n[Acc ${idx + 1}] ❓ Processing daily quiz...`));

    const client = createClient(account.proxy);
    const wallet = new ethers.Wallet(account.privateKey, provider);
    const addressLower = wallet.address.toLowerCase();

    const alreadyCompleted = await checkQuizCompleted(client, addressLower);
    if (alreadyCompleted) {
        state[idx].dailyQuiz = '✅';
        return { success: true, result: 'already_done' };
    }

    if (!QUIZ_STATE.quizData) {
        QUIZ_STATE.quizData = await fetchQuiz(client);
    }

    if (!QUIZ_STATE.quizData || !QUIZ_STATE.quizData.questions) {
        console.log(chalk.red(`   ❌ No quiz data available`));
        state[idx].dailyQuiz = '❌';
        return { success: false };
    }

    const questions = QUIZ_STATE.quizData.questions;
    console.log(chalk.cyan(`   📚 Found ${questions.length} quiz questions`));

    let answers = [];

    for (let qIndex = 0; qIndex < questions.length; qIndex++) {
        const quizItem = questions[qIndex];
        console.log(chalk.cyan(`\n   📝 Question ${qIndex + 1}/${questions.length}: ${quizItem.question}`));
        
        let optionsArray = quizItem.options || [];
        optionsArray.forEach((opt, i) => console.log(chalk.gray(`      ${i}: ${opt}`)));

        if (groqClient) {
            try {
                console.log(chalk.cyan(`   🤖 Asking Groq...`));
                const optionsText = optionsArray.map((opt, i) => `${i}: ${opt}`).join('\n');
                const completion = await groqClient.chat.completions.create({
                    model: config.groqModel,
                    messages: [
                        { role: "system", content: "Return ONLY the number (0-3)." },
                        { role: "user", content: `Question: ${quizItem.question}\nOptions:\n${optionsText}\nWhich is correct?` }
                    ],
                    temperature: 0.1,
                    max_tokens: 5
                });
                const answer = parseInt(completion.choices[0].message.content.trim());
                if (!isNaN(answer) && answer >= 0 && answer < optionsArray.length) {
                    console.log(chalk.cyan(`   🤖 Suggests: ${answer}`));
                    answers.push(answer);
                } else {
                    answers.push(1);
                }
            } catch (groqError) {
                console.log(chalk.yellow(`   ⚠️ Groq error: ${groqError.message}`));
                answers.push(1);
            }
        } else {
            answers.push(1);
        }
        await sleep(2000);
    }

    console.log(chalk.cyan(`\n   📤 All answers: [${answers.join(',')}]`));

    try {
        const res = await client.post('/functions/v1/submit-s1-quiz', {
            wallet_address: addressLower,
            answers: answers
        });
        
        console.log(chalk.gray(`   📊 Response: ${JSON.stringify(res.data)}`));
        
        if (res.data?.correct_count === res.data?.total_questions) {
            console.log(chalk.green(`\n   ✅ All correct! +${res.data.liq_earned || 50} LIQ`));
            state[idx].dailyQuiz = '✅';
            return { success: true };
        } else if (res.data?.correct_count > 0) {
            console.log(chalk.green(`\n   ✅ ${res.data.correct_count}/${res.data.total_questions} correct`));
            state[idx].dailyQuiz = '✅';
            return { success: true };
        } else {
            console.log(chalk.yellow(`\n   ⚠️ Quiz submission returned: ${JSON.stringify(res.data)}`));
            state[idx].dailyQuiz = '❌';
            return { success: false };
        }
    } catch (e) {
        const errMsg = e.response?.data?.message || e.message;
        if (errMsg.includes('already') || errMsg.includes('completed')) {
            console.log(chalk.green(`\n   ✅ Quiz already completed!`));
            state[idx].dailyQuiz = '✅';
            return { success: true, result: 'already_done' };
        }
        console.log(chalk.red(`   ❌ Quiz error: ${errMsg}`));
        state[idx].dailyQuiz = '❌';
        return { success: false };
    }
}

async function processDailyTasks(account, idx) {
    state[idx].dailyTask = '🔄';
    state[idx].webFaucet = '🔄';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const client = createClient(account.proxy);
    const addressLower = wallet.address.toLowerCase();

    // Get initial stats
    try {
        const [profileRes, streakRes] = await Promise.all([
            client.get(`/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addressLower}`),
            client.get(`/rest/v1/s1_checkins?select=checkin_date&wallet_address=eq.${addressLower}&order=checkin_date.desc&limit=50`)
        ]);
        if (profileRes.data?.[0]) {
            state[idx].points = profileRes.data[0].s1_liq_earned || 0;
            console.log(chalk.gray(`   💰 Points: ${state[idx].points}`));
        }
        if (streakRes.data) {
            state[idx].streak = streakRes.data.length;
            console.log(chalk.gray(`   🔥 Streak: ${state[idx].streak}`));
        }
    } catch {}

    // Web Faucets
    console.log(chalk.cyan(`\n💧 Web Faucets:`));
    const usdcResult = await claimWebFaucet(wallet, USDC_ADDR, idx);
    await randomSleep();
    const usdtResult = await claimWebFaucet(wallet, USDT_ADDR, idx);
    
    state[idx].webFaucet = (usdcResult.success || usdtResult.success) ? '✅' : '⏳';
    renderDashboard();

    // Daily Check-in
    console.log(chalk.cyan(`\n📅 Daily Check-in:`));
    const checkinResult = await withRetry(async () => {
        const res = await client.post('/functions/v1/s1-checkin', {}, {
            headers: { 'x-wallet-address': addressLower }
        });
        console.log(chalk.gray(`   📊 Check-in response: ${JSON.stringify(res.data)}`));
        if (res.data?.success || res.data?.already_checked_in) return true;
        throw new Error('Check-in failed');
    }, idx, 'dailyTask');
    await randomSleep();

    // Show balances
    const usdcBal = await getTokenBalance(wallet, USDC_ADDR);
    const usdtBal = await getTokenBalance(wallet, USDT_ADDR);
    console.log(chalk.cyan(`\n💰 Current Balances:`));
    console.log(chalk.gray(`   tUSDC: ${ethers.utils.formatUnits(usdcBal, 6)}`));
    console.log(chalk.gray(`   tUSDT: ${ethers.utils.formatUnits(usdtBal, 18)}`));

    // RLP Vault Deposits
    console.log(chalk.cyan(`\n🏦 RLP Vault Deposits:`));
    
    console.log(chalk.cyan(`   📥 Attempting 1000 tUSDC deposit...`));
    const usdcDeposit = await depositVault(wallet, 1, idx, 1000);
    if (usdcDeposit.success) {
        await sleep(5000);
        await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-deposit-tusdc-1000',
                token_type: 'tusdc'
            });
            if (res.data?.verified || res.data?.success) console.log(chalk.green(`   ✅ USDC verified`));
        }, idx, 'dailyTask');
    }
    await randomSleep();

    console.log(chalk.cyan(`   📥 Attempting 1000 tUSDT deposit...`));
    const usdtDeposit = await depositVault(wallet, 0, idx, 1000);
    if (usdtDeposit.success) {
        await sleep(5000);
        await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-deposit-tusdt-1000',
                token_type: 'tusdt'
            });
            if (res.data?.verified || res.data?.success) console.log(chalk.green(`   ✅ USDT verified`));
        }, idx, 'dailyTask');
    }
    await randomSleep();

    // LaaS Vault Deposits
    console.log(chalk.cyan(`\n🏛️ LaaS Vault Deposits:`));
    
    console.log(chalk.cyan(`   📥 Attempting 500 tUSDC deposit...`));
    const laasUsdc = await depositLaaSVault(wallet, 1, idx, 500);
    if (laasUsdc.success) {
        await sleep(5000);
        await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-laas-deposit-tusdc',
                token_type: 'tusdc'
            });
            if (res.data?.verified || res.data?.success) console.log(chalk.green(`   ✅ LaaS USDC verified`));
        }, idx, 'dailyTask');
    }
    await randomSleep();

    console.log(chalk.cyan(`   📥 Attempting 500 tUSDT deposit...`));
    const laasUsdt = await depositLaaSVault(wallet, 0, idx, 500);
    if (laasUsdt.success) {
        await sleep(5000);
        await withRetry(async () => {
            const res = await client.post('/functions/v1/verify-deposit-task', {
                wallet_address: addressLower,
                task_id: 'daily-laas-deposit-tusdt',
                token_type: 'tusdt'
            });
            if (res.data?.verified || res.data?.success) console.log(chalk.green(`   ✅ LaaS USDT verified`));
        }, idx, 'dailyTask');
    }
    await randomSleep();

    // Duel task verification
    await withRetry(async () => {
        const res = await client.post('/functions/v1/verify-onchain-task', {
            wallet_address: addressLower,
            task_id: 'daily-duel-create'
        });
        return res.data?.verified;
    }, idx, 'dailyTask');
    await randomSleep();

    // Daily Quiz
    await processDailyQuiz(account, idx);
    await randomSleep();

    // Final stats
    try {
        const [profileRes] = await Promise.all([
            client.get(`/rest/v1/user_profiles_public?select=total_liq_earned,s1_liq_earned&wallet_address=eq.${addressLower}`)
        ]);
        if (profileRes.data?.[0]) {
            state[idx].points = profileRes.data[0].s1_liq_earned || 0;
            console.log(chalk.cyan(`\n📊 Final Points: ${state[idx].points}`));
        }
    } catch {}

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
                wagerAmount: d.wagerAmount,
                wagerToken: d.wagerToken,
                amount: parseFloat(ethers.utils.formatUnits(d.wagerAmount, d.wagerToken.toLowerCase() === USDC_ADDR.toLowerCase() ? 6 : 18))
            }));
    } catch { return []; }
}

async function processDuel(account, idx) {
    if (account.duelEnabled === false) {
        state[idx].duelStatus = '⛔ Off';
        return;
    }

    state[idx].duelStatus = '🔄';
    renderDashboard();

    const wallet = new ethers.Wallet(account.privateKey, provider);
    const openDuels = await getOpenDuels(wallet);
    
    console.log(chalk.cyan(`\n[Acc ${idx + 1}] ⚔️ Processing duel...`));
    console.log(chalk.gray(`   🔍 Found ${openDuels.length} open duels`));

    for (const duel of openDuels) {
        if (duel.amount > 2000) continue;

        const balance = await getTokenBalance(wallet, duel.wagerToken);
        if (balance.lt(duel.wagerAmount)) {
            console.log(chalk.yellow(`   ⚠️ Insufficient balance for duel #${duel.id}`));
            continue;
        }

        console.log(chalk.cyan(`   🎯 Attempting to join duel #${duel.id}...`));

        const result = await withRetry(async () => {
            const approved = await ensureApproval(wallet, duel.wagerToken, DUEL_ADDR);
            if (!approved) throw new Error('Approval failed');
            
            const iface = new ethers.utils.Interface(DUEL_ABI);
            const data = iface.encodeFunctionData('acceptDuel', [duel.id]);

            const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
            const tx = await wallet.sendTransaction({ to: DUEL_ADDR, data, gasLimit: 1000000, gasPrice });
            console.log(chalk.gray(`   📤 TX: ${tx.hash}`));
            await tx.wait();
            return true;
        }, idx, 'duelStatus');

        if (result.success) {
            console.log(chalk.green(`   ✅ Duel joined!`));
            state[idx].duelStatus = '✅';
            state[idx].lastDuel = Date.now();
            state[idx].nextDuel = getNextDuelSchedule();
            return;
        }
    }

    console.log(chalk.cyan(`   🆕 Creating own duel...`));
    
    const useUSDC = Math.random() < 0.5;
    const tokenAddr = useUSDC ? USDC_ADDR : USDT_ADDR;
    const decimals = useUSDC ? 6 : 18;
    const balance = await getTokenBalance(wallet, tokenAddr);
    const rawAmount = randomDelay(10, 100);
    const wagerAmount = ethers.utils.parseUnits(rawAmount.toString(), decimals);

    if (balance.lt(wagerAmount)) {
        console.log(chalk.yellow(`   ⚠️ Insufficient balance to create duel`));
        state[idx].duelStatus = '❌';
        state[idx].nextDuel = getNextDuelSchedule();
        return;
    }

    const result = await withRetry(async () => {
        const approved = await ensureApproval(wallet, tokenAddr, DUEL_ADDR);
        if (!approved) throw new Error('Approval failed');
        
        const iface = new ethers.utils.Interface(DUEL_ABI);
        const data = iface.encodeFunctionData('createDuel', [wagerAmount, tokenAddr, 0]);

        const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
        const tx = await wallet.sendTransaction({ to: DUEL_ADDR, data, gasLimit: 1000000, gasPrice });
        console.log(chalk.gray(`   📤 TX: ${tx.hash}`));
        await tx.wait();
        return true;
    }, idx, 'duelStatus');

    if (result.success) {
        console.log(chalk.green(`   ✅ Duel created!`));
        state[idx].duelStatus = '✅';
        state[idx].lastDuel = Date.now();
        state[idx].nextDuel = getNextDuelSchedule();
    } else {
        state[idx].duelStatus = '❌';
        state[idx].nextDuel = getNextDuelSchedule();
    }
}

async function syncDailyStats(account, idx) {
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
        console.log(chalk.blue(`[Acc ${idx + 1}] 🔄 Synced: ${state[idx].dailyDuelCount} duels`));

    } catch (e) {
        console.log(chalk.red(`[Acc ${idx + 1}] ❌ Sync Failed: ${e.message}`));
    }
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
                s.nextDiscord = getNextDiscordSchedule();
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
