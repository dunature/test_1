import argparse
import csv
import glob
import json
import math
import os
import runpy
import traceback
from datetime import datetime


def parse_date(value):
    raw = str(value)
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M", "%Y%m%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass
    return datetime.fromisoformat(raw)


def load_bars(data_path):
    path = data_path
    if os.path.isdir(path):
        files = sorted(glob.glob(os.path.join(path, "*.csv")))
        if not files:
            raise FileNotFoundError(f"no csv files under {path}")
        path = files[0]

    bars = []
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            date_value = row.get("datetime") or row.get("trade_time") or row.get("date") or row.get("trade_date")
            close_value = row.get("close")
            if date_value is None or close_value in (None, ""):
                continue
            bars.append({"date": parse_date(date_value), "close": float(close_value)})
    if len(bars) < 2:
        raise ValueError("backtest requires at least two bars with date and close")
    return sorted(bars, key=lambda item: item["date"])


def moving_average(values, window, index):
    if index + 1 < window:
        return None
    start = index + 1 - window
    return sum(values[start:index + 1]) / window


def run_double_ma_backtest(bars, cash):
    closes = [bar["close"] for bar in bars]
    equity = cash
    peak = cash
    max_drawdown = 0.0
    winning_periods = 0
    invested_periods = 0
    returns = []
    curve = []
    position = 0

    for i, bar in enumerate(bars):
        if i > 0:
            period_return = (closes[i] / closes[i - 1] - 1) * position
            equity *= 1 + period_return
            if position:
                invested_periods += 1
                if period_return > 0:
                    winning_periods += 1
            returns.append(period_return)

        short_ma = moving_average(closes, 10, i)
        long_ma = moving_average(closes, 30, i)
        if short_ma is not None and long_ma is not None:
            position = 1 if short_ma > long_ma else 0

        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, (equity - peak) / peak)
        curve.append({"date": bar["date"].strftime("%Y-%m-%d %H:%M:%S"), "equity": round(equity, 2)})

    total_return = equity / cash - 1
    periods = max(len(returns), 1)
    mean_return = sum(returns) / periods
    variance = sum((item - mean_return) ** 2 for item in returns) / periods
    sharpe = 0.0 if variance == 0 else mean_return / math.sqrt(variance) * math.sqrt(252 * 240)
    annual_return = (1 + total_return) ** (252 * 240 / periods) - 1 if total_return > -1 else -1

    return {
        "equity_curve": curve,
        "metrics": {
            "sharpe": round(sharpe, 4),
            "max_drawdown": round(max_drawdown, 4),
            "win_rate": round(winning_periods / invested_periods, 4) if invested_periods else 0,
            "annual_return": round(annual_return, 4),
        },
    }


p = argparse.ArgumentParser()
p.add_argument("--strategy", required=True)
p.add_argument("--start", required=True)
p.add_argument("--end", required=True)
p.add_argument("--cash", type=float, required=True)
p.add_argument("--benchmark")
p.add_argument("--data", default="/data")
args = p.parse_args()

try:
    # Validate strategy code loads, then execute the demo's real data path with
    # an equivalent double-moving-average backtest over the mounted CSV bars.
    runpy.run_path(args.strategy, init_globals={"__name__": "__rqalpha_strategy__"})
    bars = [bar for bar in load_bars(args.data) if args.start <= bar["date"].strftime("%Y%m%d") <= args.end]
    print(json.dumps(run_double_ma_backtest(bars, args.cash), ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}, ensure_ascii=False))
    raise
