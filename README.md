# 🏹 Gandiva: Pay-per-Call Agent Economy

**AI agents that hire other AI agents and pay them per request, in USDC, with no human in the loop.**

### 🔗 Live demo: **[gandiva-navy.vercel.app](https://gandiva-navy.vercel.app/)**

![x402 v2](https://img.shields.io/badge/x402-v2-c2410c) ![Base Sepolia](https://img.shields.io/badge/network-Base%20Sepolia-0052ff) ![USDC](https://img.shields.io/badge/paid%20in-USDC-2775ca) ![TypeScript](https://img.shields.io/badge/TypeScript-Next.js%20%2B%20Hono-3178c6)

![Gandiva home page](docs/screenshots/home.png)

## The Problem

AI agents can already plan and act, but they can't **pay**. To use a paid API today, a human has to sign up, add a card, copy an API key and watch the invoices. That doesn't work when an agent needs a currency rate for ₹0.08, once, right now.

## Our Solution

Gandiva is a marketplace where agents buy services from other agents, one call at a time. Think of it as **UPI for AI agents**:

1. A seller lists a service (price, wallet, input/output format) in the **registry**.
2. Our buyer agent **Scout** takes a plain-language task and a budget, picks the best sellers and calls them.
3. Each seller replies **`402 Payment Required`** with its price. Scout checks the price, signs a USDC payment, and gets the result.
4. Every call settles **on-chain with its own transaction hash**. No API keys, no cards, no invoices.

Example task:

> *From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in **rupees**, and summarise each description in **Hindi**.* Budget: 0.05 USDC

Scout hires a scraper, an FX-rate seller and a Hindi-summary seller, pays each one per call (about 0.04 USDC in total), checks every answer, and explains what it bought, from whom, and why.

## Screenshots

**Marketplace and personal agent wallet**

![Marketplace with agent wallet](docs/screenshots/marketplace-wallet.png)

## Try It Live

1. Open **[gandiva-navy.vercel.app](https://gandiva-navy.vercel.app/)**. The API runs on a free server, so the first load can take up to a minute.
2. **Sign in** with MetaMask on the Base Sepolia testnet (top-right).
3. On **Marketplace**, add test USDC to your **agent wallet** (free from [faucet.circle.com](https://faucet.circle.com)).
4. Go to **Run task**, pick an example, set a budget and run it. Watch each 402, payment and transaction happen live.
5. Open **Ledger** to see every call with its amount, status and a BaseScan link. You can withdraw from the agent wallet at any time, gas-free.
6. Want to earn? On **Sell**, list your own x402 endpoint and get paid per call to your wallet.

## Features

- **Registry and marketplace:** search services by category and price, with reputation (success rate, latency) and a credibility score that needs no KYC.
- **Buyer agent "Scout":** an LLM plans the calls; deterministic code validates every plan, checks the cost and pays. Bad sellers are skipped automatically.
- **8 live sellers:** 5 real ones (book scraping, FX rates, city weather, Hindi summary, sentiment) and 3 demo bad actors.
- **Personal agent wallets:** sign in with your wallet, fund your own agent and set a spend limit.
- **Sell tab:** list any x402 endpoint; the registry checks its real 402 against the listing.
- **Ledger:** every attempted call with time, seller, price, amount paid, tx hash, status and latency, plus a seller sales view.

## Payment Safety

| Risk | How Gandiva protects the buyer |
|---|---|
| Overspending | Budget is reserved before each payment, under a lock; safe even with parallel calls |
| Price gouging or wallet swap | The 402 must match the registry listing (price, token, network, payTo), otherwise nothing is signed |
| Replay | Each signature can be used once; resending it moves no money |
| Paying for junk | Sellers settle only after validating their own output; Scout re-checks it against the schema |
| Seller failure | Error or timeout means no settlement, so no charge |
| Runaway agents | A rolling spend cap on every wallet |

Three demo sellers misbehave on purpose so you can watch these checks work: `cheap-scraper` asks 10x its listed price, `mirror-scraper` asks to be paid to a different wallet, and `junk-fx` returns broken output.

## How It Works

```mermaid
sequenceDiagram
    participant S as Scout (buyer agent)
    participant R as Registry
    participant X as Seller
    participant F as x402 Facilitator
    participant B as Base Sepolia (USDC)

    S->>R: Find sellers by category and price
    S->>X: Call the service
    X-->>S: 402 Payment Required (price, payTo)
    Note over S: CHECKED: 402 matches the listing, budget reserved
    Note over S: SIGNED: EIP-3009 USDC authorisation
    S->>X: Retry with PAYMENT-SIGNATURE
    X->>F: Verify the payment
    Note over F: VERIFIED: signature, amount, payTo
    X->>X: Run the job and validate the output
    X->>F: Settle
    F->>B: transferWithAuthorization
    Note over B: SETTLED: one tx hash per call
    X-->>S: 200 OK + result + PAYMENT-RESPONSE (tx hash)
    Note over S: Output re-checked, written to the ledger
```

```
Next.js web app (Vercel)  ──proxy──▶  Hono API (Render)
                                        ├─ Registry + Ledger (SQLite)
                                        ├─ Sellers (x402 paid routes)
                                        └─ Scout buyer agent + SafePayer
                                                 │ x402 v2
                                                 ▼
                               x402.org facilitator ▶ Base Sepolia USDC
```

## Public URLs and Wallets

All on the **Base Sepolia testnet** (chain ID 84532). Only public addresses are listed here, never keys.

| What | URL |
|---|---|
| Web app (dashboard) | https://gandiva-navy.vercel.app |
| API | https://gandiva-api.onrender.com |
| Registry | https://gandiva-api.onrender.com/registry/services |
| Health check | https://gandiva-api.onrender.com/healthz |

**Sellers** (each endpoint answers with an x402 `402 Payment Required` until paid):

| Seller | Category | Price (USDC) | Endpoint | payTo wallet |
|---|---|---|---|---|
| shelf-scraper | scraping | 0.005 | `GET /sellers/shelf-scraper/scrape` | [0xC91E…9679](https://sepolia.basescan.org/address/0xC91Ed2DB12D92C99987e4D2f85b405C96fA39679) |
| fx-rates | data | 0.001 | `GET /sellers/fx-rates/rate` | [0x761b…07af](https://sepolia.basescan.org/address/0x761b109231305f2a42b2d4829A10E6905AEa07af) |
| city-info | data | 0.002 | `GET /sellers/city-info/city` | [0xB424…864a](https://sepolia.basescan.org/address/0xB424aD5901Eb351e83dC388836CAb3aE9138864a) |
| hindi-summary | inference | 0.010 | `POST /sellers/hindi-summary/summarise` | [0x2067…3559](https://sepolia.basescan.org/address/0x20670d6c8dF9F650453115c92bc616DE89B53559) |
| sentiment | inference | 0.003 | `POST /sellers/sentiment/analyse` | [0x7CCC…5f94](https://sepolia.basescan.org/address/0x7CCC1a190870F762f614567A264E576cDBF05f94) |
| cheap-scraper ⚠️ overcharges | scraping | 0.002 (asks 0.020) | `GET /sellers/cheap-scraper/scrape` | [0x1CE4…c871](https://sepolia.basescan.org/address/0x1CE46619b914206Cb39aB285102F0215b4abc871) |
| mirror-scraper ⚠️ wrong payTo | scraping | 0.001 | `GET /sellers/mirror-scraper/scrape` | [0xd414…2Dce](https://sepolia.basescan.org/address/0xd4148ec37E180d5598C0a394d43F1213FE052Dce) |
| junk-fx ⚠️ broken output | data | 0.0008 | `GET /sellers/junk-fx/rate` | [0x249e…5046](https://sepolia.basescan.org/address/0x249e5b90aebd44aD89b4F8A64a26FECaeF635046) |

Endpoints are relative to `https://gandiva-api.onrender.com`.

| Wallet | Address |
|---|---|
| Buyer (Scout) | [0xC2410105bfB318d2bb6fBb8ECE7Eadc9e1041B0B](https://sepolia.basescan.org/address/0xC2410105bfB318d2bb6fBb8ECE7Eadc9e1041B0B) |
| Attacker wallet (named in mirror-scraper's fake 402) | [0x233e5D6b13b25f6B306cF32C7A45e06e620b436d](https://sepolia.basescan.org/address/0x233e5D6b13b25f6B306cF32C7A45e06e620b436d) |
| USDC token | [0x036CbD53842c5426634e7929541eC2318f3dCF7e](https://sepolia.basescan.org/token/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

## Example Tasks

Each one uses all three categories (scraping, data, inference):

1. *From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarise each description in Hindi.*
2. *Check the weather in Tokyo, then give the two cheapest books on page 1 of books.toscrape.com in Tokyo's local currency, with a Hindi summary of each.*
3. *From pages 1 to 2 of books.toscrape.com, find the three cheapest 5-star books, give their prices in euros, and say whether each description sounds positive or negative.*

## Run It Locally

**Needs:** Node.js 20+, an [ngrok](https://ngrok.com/download) or cloudflared tunnel, and an LLM via [Ollama](https://ollama.com) (local or cloud).

```bash
npm install && cd client && npm install && cd ..
cp .env.example .env        # add your tunnel token and Ollama settings
npm run wallets:new         # creates fresh testnet wallets in .env
# fund the buyer wallet with test USDC: https://faucet.circle.com (Base Sepolia)
npm start                   # one command: tunnel + API + web app
```

Then open the URL printed in the terminal. To check the safety claims: `npm test` (300+ offline tests), `npm run reconcile`, and the `npm run judge:*` scripts.

> ⚠️ Testnet only. Never put mainnet keys in `.env`.

## Tech Stack

Node.js, TypeScript, Hono, SQLite, Next.js 16, Tailwind v4, x402 SDKs (`@x402/*`), viem, Ollama (gpt-oss), Vitest. Hosted on Vercel (UI) and Render (API).

## More Details

The credibility score, seller comparison, the payment scheduler, every judge script and the deploy steps are in **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.

## License

ISC
