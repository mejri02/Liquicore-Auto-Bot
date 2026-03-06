# 🔷 Liquicore Auto Bot

> Automated bot for [Liquicore Finance](https://liquicore.finance?ref=FB239416) — handles daily tasks, faucet claims, vault deposits, duels, flow wars, badges, capsules, governance voting, and more across multiple accounts.

---

## 🔗 Register First

> 👉 **[https://liquicore.finance?ref=FB239416](https://liquicore.finance?ref=FB239416)**

Register using the referral link above before getting started.

---

## ✨ Features

### Core Automation
- 📅 **Daily Tasks** — Auto check-in, deposit verification for RLP Vault & LaaS Vault
- 🌐 **Web Faucet** — Auto-claim tUSDC and tUSDT testnet tokens
- 💬 **Discord Faucet** — Auto-click faucet buttons (BNB, USDC, USDT) in Discord channels every 30 minutes
- ❓ **Daily Quiz** — AI-powered answers via Groq (llama-3.3-70b) with shared perfect-answer cache across accounts
- ⚔️ **Duel System** — Try to join open duels (up to 3 attempts), fallback to creating new ones (1 duel/day limit), with expired duel resolution
- 🏦 **Vault Deposits** — RLP Vault (1000 tUSDC / 1000 tUSDT) + LaaS Vault (500 tUSDC / 500 tUSDT)
- 🏦 **Auto Vault Withdraw** — Withdraws excess balance from RLP Vault, keeping a configurable reserve
- 🎁 **Auto Claim Rewards** — Claims duel prizes via `claimMultiple` and refunds on-chain, syncs DB after claim

### New in v9.1
- 🎲 **Centralized Jitter** — All interval timers now use a configurable `addJitter()` function (`jitterMin`/`jitterMax` in config) for more natural, randomized scheduling across every task

### New in v9.0
- ⚡ **Flow Wars** — Auto-matchmaking and puzzle route submission with cooldown tracking
- 🏅 **Badge Auto-Verify** — Iterates over 50+ badge IDs and verifies eligibility with OG sync after each earn
- 💊 **Capsule Claim** — Tracks badge count, determines eligible capsule slots, and requests claim signatures
- 👥 **Referral Processing** — Applies referral codes once per account and skips if already used
- 🗳️ **Governance Voting** — On-chain votes via `GOV` contract (up to 5 pools/day), auto-deposits for voting power if needed
- 🌊 **Wave Points** — Fetches and triggers OG wave-point accrual per account
- 📊 **LIQ Reward Log** — Pulls today's reward log and reports total LIQ earned and top action
- 🏆 **Leaderboard Tracking** — Periodically fetches rank and total LIQ from the S1 badge leaderboard
- 💬 **Discord Link Verify** — Verifies Discord social link per wallet
- 🔁 **Gov Vote Sync** — Syncs governance votes to the backend before each vote cycle
- 🔄 **Expired Duel Resolver** — Detects and resolves active duels older than 24 hours

### Infrastructure
- 🔄 **Multi-Account** — Manage unlimited accounts from `accounts.json`
- 🛡️ **Anti-Detection** — Random delays, rotating user agents, request jitter, session ID spoofing
- 🔁 **RPC Health Monitor** — Pings all BSC Testnet RPCs and automatically switches to the fastest healthy one
- 🔀 **Wallet Rotation** — Shuffles account processing order every 10 loops to reduce fingerprinting
- ⛽ **Dynamic Gas** — Uses EIP-1559 fee data with a 10% buffer; falls back to legacy gas price
- 📊 **Live Dashboard** — Real-time terminal UI (v9.0) with per-account status, timers, wave points, gov sync indicator, and error log

---

## 📋 Requirements

- Node.js v18+

---

## 📥 Installation

```bash
git clone https://github.com/mejri02/Liquicore-Auto-Bot.git
cd Liquicore-Auto-Bot
npm install
```

---

## 📁 File Structure

```
Liquicore-Auto-Bot/
├── index.js          # Main bot file
├── accounts.json     # Account configuration (see below)
├── config.json       # Optional: Groq API key and overrides
└── README.md
```

---

## ⚙️ Configuration

### `accounts.json`

Create an `accounts.json` file in the same directory as `index.js`:

```json
[
  {
    "privateKey": "0xYOUR_PRIVATE_KEY",
    "discordToken": "YOUR_DISCORD_TOKEN",
    "proxy": "http://user:pass@host:port",
    "duelEnabled": true,
    "referralCode": "YOUR_REFERRAL_CODE"
  },
  {
    "privateKey": "0xSECOND_PRIVATE_KEY",
    "discordToken": "SECOND_DISCORD_TOKEN",
    "proxy": null,
    "duelEnabled": true
  }
]
```

| Field | Required | Description |
|---|---|---|
| `privateKey` | ✅ | EVM wallet private key (BSC Testnet) |
| `discordToken` | ⚠️ Optional | Discord user token for faucet claims and social verification |
| `proxy` | ⚠️ Optional | HTTP/HTTPS proxy URL (`null` to disable) |
| `duelEnabled` | ⚠️ Optional | Set to `false` to disable duels for this account |
| `referralCode` | ⚠️ Optional | Referral code to apply on first run |

### `config.json` (Optional)

To enable Groq AI for the daily quiz, create a `config.json`:

```json
{
  "grokApiKey": "YOUR_GROQ_API_KEY"
}
```

Without this file the bot runs normally but falls back to a heuristic analyzer for quiz answers.

---

## 🚀 Usage

```bash
node index.js
```

The bot will:
1. Load all accounts from `accounts.json`
2. Initialize Groq AI (if API key is configured)
3. Run an initial RPC health check and select the fastest node
4. Sync current duel history from the blockchain
5. Launch the live dashboard
6. Run all tasks automatically on schedule

**Stop the bot:** Press `Ctrl+C`

---

## ⏰ Schedule

| Task | Frequency |
|---|---|
| Daily Tasks (check-in, deposits, quiz, faucet, claims, referral) | Once daily at 08:00 |
| Discord Faucet | Every 30 minutes |
| Duels | After each attempt; resets daily |
| Flow Wars | Every 30 minutes + jitter |
| Badge Auto-Verify | Every 4 hours + jitter |
| Capsule Check | Every 2 hours |
| Governance Voting | Every 2 hours + jitter |
| Leaderboard Sync | Every 1 hour |
| RPC Health Monitor | Every 5 minutes |
| Activity Simulation | Every 15 minutes |

---

## 📊 Dashboard

The live terminal dashboard (v9.1) shows per-account status for all tracked tasks:

| Column | Description |
|---|---|
| 💎 LIQ | Season 1 LIQ points earned |
| 🔥 Streak | Current daily check-in streak |
| 🏆 Rank | Leaderboard position |
| 🌊 Wave | OG wave points |
| ✦ GovSync | Governance sync indicator |
| 🔔 Discord | Discord faucet status |
| 🌐 Faucet | Web faucet claim status |
| 📅 Daily | Daily check-in status |
| ❓ Quiz | Daily quiz status |
| 🗳 Gov | Governance vote status |
| ⚔ Duel | Duel status |
| 🏦 Vault | Vault withdraw status |
| 🎁 Claims | Prize claim status |
| ⚡ FlowWar | Flow Wars status |
| 🏅 Badges | Badge verification status |
| 💊 Capsule | Capsule claim status |
| 👥 Refer | Referral status |

**Status icons:**

| Icon | Meaning |
|---|---|
| ✅ | Completed successfully |
| ❌ | Failed |
| 🔄 | In progress |
| ⏳ | Waiting / cooldown |
| 🟡 | Ready / pending action |
| ✅Limit | Daily limit reached |
| ⛔ Off | Feature disabled for this account |
| ⏳CD | Cooldown active |
| ⏳RL | Rate limited (retrying) |

---

## 🔗 Contract Addresses (BSC Testnet — S1 Season)

| Contract | Address |
|---|---|
| S1-tUSDC (6 decimals) | `0xaD88B079712CC38a8D33E072CB6434E652556441` |
| S1-tUSDT (18 decimals) | `0x5c0d9bb86b99168Aa8A36fad84d068d258c259a5` |
| S1 RLP Vault | `0xC044428E4f0b46C9897730fc9137806Ed8deBB9d` |
| S1 LaaS Vault | `0xB8332cfE7DddD45CEcAADA6C0e564b09AbBb5744` |
| S1 Duel | `0xFbB6a304e361AE93B33A87a3700CC1CF1b2bAc8c` |
| S1 Payout | `0x1721EbeA050E33f6c581dE6bc231354aa38E5361` |
| S1 Governance | `0xd53868E4b0c16ED332f37f005d4851D3EB547deB` |

---

## ⚠️ Disclaimer

This bot is for educational and personal use only. Use at your own risk. The author is not responsible for any loss of funds or account bans. Never use this with real funds on mainnet.

---

## 🙏 Credits

- **Author:** [mejri02](https://github.com/mejri02)
- **Platform:** [Liquicore Finance](https://liquicore.finance?ref=FB239416)
- **Network:** BSC Testnet
