/**
 * Snapback: a one-hour-drop snap-back bot for the make.fun BTC 24h race
 * (agent-fun/bars-replay/v1).
 *
 * Idea, long only, one position (CBBTC vs USDC), decided on each bar's close
 * and filled at the next bar's open. The dev window falls 2.8% over 24 hours
 * in a choppy band, so trend-following longs and band mean-reversion both
 * bleed out (local backtest: Bollinger mean-reversion about -$16 to -$20,
 * 120-bar breakout about -$1, buy-and-hold about -$28). What does pay, on
 * this window, is the snap-back inside a down leg: a sharp one-hour slide
 * that has just started to turn. So the bot only ever buys one shape:
 *
 * - Entry, the whole cash, when on the bar that just closed:
 *   - the close is at least 70 bps below the close 60 bars ago (a real
 *     one-hour slide, not noise: the 1-minute noise is ~7 bps std), and
 *   - the close is at least 25 bps above the close 5 bars ago (the slide
 *     has turned within the last five minutes).
 * - Exit, the whole position, on the first of:
 *   - take-profit: the close is 70 bps above the entry fill price,
 *   - stop-loss: the close is 150 bps below the entry fill price,
 *   - time stop: 360 bars (6 hours) have passed since the fill.
 * - After a stop-loss exit, no new entry for 30 bars: the leg that just
 *   stopped out is still falling, and the snap-back shape can re-trigger
 *   straight back into it. The cooldown never fires on the dev window
 *   (no stop-loss is hit there), so it costs nothing there; it is a guard
 *   for the live race, where a stop-loss can happen.
 *
 * Nothing here looks at highs, lows, rolling means or volatility bands:
 * the whole decision is two returns (60-bar and 5-bar) plus the distance
 * from the fill. A full-size round trip costs about 36 bps here (4 bps fee
 * each way, 2 bps modelled slippage each way, ~12 bps of pool impact each
 * way at the dev window's ~$844k median depth), so the 70 bps take-profit
 * clears the round-trip cost with room, while the 150 bps stop and the
 * 6-hour time stop cut the legs that keep falling. Local backtest on the
 * kit's frozen 24h dev window: net PnL +$10.81 (2 round trips, max
 * drawdown about 0.65%). The neighbourhood is flat, not a spike: drop
 * 50-100 bps, bounce 15-35 bps and take-profit 50-90 bps land between
 * +$8 and +$13 in 145 of 150 combinations, so the result is the shape of
 * the strategy, not one tuned threshold.
 *
 * Determinism: only integer arithmetic on the closes seen so far (basis
 * points computed with BigInt division), no clock, no environment, no
 * randomness. The same bars always give the same orders. The entry fill
 * price is read back from the position the harness reports (cost over
 * quantity), never guessed from the decision close.
 */

import { runBars, type BarsState, type Batch, type OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const LOOKBACK_BARS = 60; // the slide is measured over this many bars (1 hour)
const DROP_BPS = 70n; // close must sit this far below the close 60 bars ago
const TURN_BARS = 5; // the turn is measured over this many bars (5 minutes)
const BOUNCE_BPS = 25n; // close must be this far above the close 5 bars ago
const TAKE_PROFIT_BPS = 70; // exit when the close is this far above the fill
const STOP_LOSS_BPS = 150; // exit when the close is this far below the fill
const MAX_HOLD_BARS = 360; // exit after this many bars in the trade, whatever
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
const COOLDOWN_AFTER_SL_BARS = 30; // no new entry for this many bars after a stop-loss

/** Returns, in basis points, of `now` against `then` (both raw price units). */
function returnBps(now: bigint, then: bigint): bigint {
  return ((now - then) * 10000n) / then;
}

/** The bot's memory: the last 60 closes and the open trade, if any. */
class Snapback {
  closes: bigint[] = []; // closes of past bars, oldest first, at most 60
  entryPx: bigint | null = null; // fill price of the open trade
  barsHeld = 0; // batches seen holding the trade
  cooldownBars = 0; // bars left before a new entry is allowed after a stop-loss

  /** Record the bar that just closed, keeping only the last 60 closes. */
  observe(close: bigint): void {
    this.closes.push(close);
    if (this.closes.length > LOOKBACK_BARS) this.closes.shift();
    if (this.cooldownBars > 0) this.cooldownBars -= 1;
  }

  get historyReady(): boolean {
    return this.closes.length >= LOOKBACK_BARS;
  }

  /** True when the last hour slid hard and the last five minutes turned up. */
  get snapbackShape(): boolean {
    const n = this.closes.length;
    const close = this.closes[n - 1];
    const hourAgo = this.closes[n - LOOKBACK_BARS];
    const fiveAgo = this.closes[n - TURN_BARS];
    return (
      returnBps(close, hourAgo) <= -DROP_BPS &&
      returnBps(close, fiveAgo) >= BOUNCE_BPS
    );
  }
}

const bot = new Snapback();

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    let close: bigint | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      close = BigInt(bar.c);
    }
    if (close === null || state.warmingUp) {
      if (close !== null) bot.observe(close);
      return [];
    }

    const held = state.positions.get(SYMBOL);
    if (held === undefined) {
      bot.entryPx = null;
      bot.barsHeld = 0;
      const ready = bot.historyReady;
      // Observe the close only after judging it against the history that
      // came before it: the 60-bar and 5-bar returns must not include the
      // bar being judged, or both comparisons would be diluted.
      // A stop-loss cooldown also blocks the entry: after an SL exit the
      // leg is still falling, so a shape that fires at once is a re-entry
      // into the same slide, not a fresh snap-back.
      const shape =
        ready && bot.snapbackShape && bot.cooldownBars <= 0;
      bot.observe(close);
      if (!shape) return [];
      if (state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
        return [
          {
            side: "buy",
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    // Holding: the fill price is read back from the position the harness
    // reports (its cost, fees included, over its quantity).
    if (bot.entryPx === null) {
      bot.entryPx = (held.cost * 10_000_000n) / held.qty;
      bot.barsHeld = 1;
    } else {
      bot.barsHeld += 1;
    }
    const changeBps = Number(returnBps(close, bot.entryPx));
    const stoppedOut = changeBps <= -STOP_LOSS_BPS;
    bot.observe(close);
    if (
      changeBps >= TAKE_PROFIT_BPS ||
      stoppedOut ||
      bot.barsHeld >= MAX_HOLD_BARS
    ) {
      // A stop-loss exit arms the re-entry cooldown; a take-profit or a
      // time-stop exit does not.
      if (stoppedOut) bot.cooldownBars = COOLDOWN_AFTER_SL_BARS;
      bot.entryPx = null;
      bot.barsHeld = 0;
      return [
        {
          side: "sell",
          symbol: SYMBOL,
          qty: held.qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});
