# btc-race-24h-20261118-1444

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Abay26/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Abay26/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Snapback — a one-hour-drop snap-back bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, in the make.fun BTC 24h race. It buys only when the close is at least 70 bps below the close 60 bars ago and at least 25 bps above the close 5 bars ago — a sharp one-hour slide that has just started to turn — then exits on a +70 bps take-profit, a -150 bps stop-loss or a 6-hour time stop.

Local backtest on the kit's frozen 24h dev window: **net PnL +$10.81** (2 round trips, max drawdown about 0.65%), versus about -$28 for buy-and-hold on the same window. The neighbourhood is flat, not a spike: drop 50-100 bps, bounce 15-35 bps and take-profit 50-90 bps land between +$8 and +$13 in 145 of 150 combinations, so the result is the shape of the strategy, not one tuned threshold.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout) via the vendored `vendor/makefun-bars.ts` shim (a byte-for-byte copy of the kit's TypeScript SDK shim). Standard library only, no network, no clock, no randomness — the same bars always give the same orders.

---

Built for [make.fun](https://make.fun/r/qw56w9dq) — referral code `qw56w9dq`.
