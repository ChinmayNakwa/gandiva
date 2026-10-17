# 🏹 Gandiva: Pay-per-Call Agent Economy

A marketplace where **AI agents hire other agents and pay per request in USDC**, using **x402 v2** HTTP payments on **Base Sepolia**. No API keys, no cards, no invoices. A seller answers `402 Payment Required`, the buyer signs an EIP-3009 authorisation, and the facilitator settles it on-chain. Every paid call gets its own transaction hash.

## Features

- **Registry:** sellers list services (price, `payTo`, input/output JSON Schema); searchable via HTTP and the web app.
- **Sellers:** scraping, FX rates, city weather, Hindi summary, sentiment, plus `travel-brief`, an agent that hires other sellers from its own wallet.
- **Buyer agent "Scout":** takes a plain-language task and a budget. An LLM plans the calls; deterministic code validates every plan, checks cost, and pays. Failed or dishonest sellers are skipped automatically.
- **Paid MCP tools:** `POST /mcp` lets any x402-capable MCP client use the marketplace.
- **Ledger and web app (Next.js):** every call with status, amount, tx hash and latency, plus a seller sales view.

## Payment Safety

| Risk | Protection |
|---|---|
| Overspending | Budget reservations under a mutex; safe at any concurrency |
| Price gouging / payTo swap | 402 must match the registry listing, otherwise nothing is signed |
| Replay | Nonce claimed atomically; one signature, one payment |
| Paying for junk | Seller settles only after validating its own output; buyer re-checks the schema |
| Unknown outcomes | Marked `unconfirmed`, then resolved against the chain |
| Runaway agents | Wallet-wide rolling spend cap |

## Tech Stack

Node.js, TypeScript, Hono, SQLite, Next.js 16, Tailwind v4, x402 SDKs (`@x402/*`), viem, Ollama, MCP, Vitest.

## Architecture

```
Next.js web app :3000  ──proxy──▶  Hono API :4021
                                     ├─ Registry + Ledger (SQLite)
                                     ├─ Sellers (x402 paid routes)
                                     └─ Buyer agent Scout + SafePayer
                                              │ x402 v2
                                              ▼
                            x402.org facilitator ▶ Base Sepolia USDC
```

## How to Run (Hackathon Quick Start)

**Requirements:** Node.js 20+, a tunnel ([ngrok](https://ngrok.com/download) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)), and an LLM via [Ollama](https://ollama.com) (local `ollama pull qwen2.5:7b`, or Ollama cloud with `OLLAMA_API_KEY`).

```bash
# 1. Install
npm install
cd client && npm install && cd ..

# 2. Configure
cp .env.example .env          # add NGROK_AUTHTOKEN and your Ollama settings
npm run wallets:new           # generates testnet wallets into .env

# 3. Fund the buyer wallet with testnet USDC (no ETH needed)
#    https://faucet.circle.com  ->  Base Sepolia

# 4. Start everything (tunnel + API + web app)
npm start
```

Open the public URL printed in the terminal (or `http://localhost:3000` with `TUNNEL=none`), go to **/run**, and try:

> *From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarise each description in Hindi.* Budget: `0.05`

Or from the CLI:

```bash
npm run task -- "<task>" 0.05 3
```

**Verify the claims:** `npm test` (70+ offline tests), `npm run reconcile`, `npm run judge:budget`, `npm run judge:price`, `npm run judge:replay`, `npm run judge:junk`.

> ⚠️ Testnet only. Never put mainnet keys in `.env`.

## Seller trust, comparison and scheduling

### Seller staking (SellerStake on Base Sepolia)

`contracts/SellerStake.sol` lets sellers bond USDC behind their listings:

- **Staking needs no gas.** The seller signs a USDC `ReceiveWithAuthorization` (EIP-3009) to the contract, and the registry's arbiter wallet relays it.
- **Junk triggers a refund.** When the buyer pays and the output then breaks the seller's own schema (or the seller charged for an error), the arbiter calls `slash`. That refunds the buyer what it paid, out of the bond, once per ledger row.
- **Unstaking** is a signed EIP-712 message, then a cooldown (10 min by default) during which the bond can still be slashed. After that, anyone can trigger `withdraw`, which only ever pays the seller.
- **Reconciliation is unaffected.** Refunds are transfers *to* the buyer.

```bash
npm run wallets:new          # creates ARBITER_PRIVATE_KEY and prints its address
# send ~0.01 Base Sepolia ETH to the arbiter (it pays gas for deploy, relays and slashes)
npm run stake:deploy         # deploys, writes STAKE_CONTRACT to .env; restart the server
npm run stake:seed           # built-in sellers stake part of their earnings (signed, relayed)
```

Sellers stake from the Sell tab: they sign in their wallet and pay no gas. The contract tests run in an in-process EVM (`tests/sellerStake.test.ts`).

### Credibility without KYC

Each listing gets a score out of 100 from proofs a seller can give with code, keys or money, never identity documents. `GET /registry/services/:id/credibility` returns the breakdown.

| Check | Points | How it is proven |
|---|---|---|
| x402 conformance | 20 | A live probe of the endpoint returns a 402 that matches the listing |
| Controls its payout wallet | 15 | A signature from the payTo key: `POST /registry/services/:id/proof`, a wallet sign-in on the Sell tab, or a stake (which needs that key) |
| Track record | 25 | Valid-output rate from the buyer's ledger; full credit from 10 calls |
| Stake | 20 | USDC bonded in SellerStake; full credit from 0.05, minus 5 per slash |
| On-chain wallet history | 10 | The payTo has sent transactions or holds USDC on Base Sepolia |
| HTTPS | 5 | The endpoint uses TLS |
| Listing age | 5 | Listed for at least an hour |

Credibility breaks ties in ranking: after reputation and price, before latency. The built-in sellers' proofs are signed at boot with their keys from `.env`.

## License

ISC
