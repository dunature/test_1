"""Minimal rqalpha-style Mod adapter for the sandbox runner.

The real rqalpha engine exposes StrategyContext -> EventBus -> Mod hooks.
This adapter keeps that contract explicit inside the constrained runner so the
Node backtest tool can depend on a stable plugin surface while Phase 2 evolves
from the lightweight CSV simulation toward native rqalpha mods.
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List


@dataclass
class StrategyContext:
    start_date: str
    end_date: str
    initial_cash: float
    benchmark: str | None = None
    state: Dict[str, Any] = field(default_factory=dict)


class EventBus:
    def __init__(self):
        self._handlers: Dict[str, List[Callable[[StrategyContext, Dict[str, Any]], None]]] = {}
        self.events: List[Dict[str, Any]] = []

    def subscribe(self, event: str, handler: Callable[[StrategyContext, Dict[str, Any]], None]) -> None:
        self._handlers.setdefault(event, []).append(handler)

    def publish(self, event: str, context: StrategyContext, payload: Dict[str, Any] | None = None) -> None:
        payload = payload or {}
        self.events.append({"event": event, "payload": self._safe_payload(payload)})
        for handler in self._handlers.get(event, []):
            handler(context, payload)

    def _safe_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        safe: Dict[str, Any] = {}
        for key, value in payload.items():
            if key == "code":
                safe[key] = f"<strategy:{len(str(value))} chars>"
            elif key == "result" and isinstance(value, dict):
                safe[key] = {"metrics": value.get("metrics"), "equity_points": len(value.get("equity_curve", []))}
            else:
                safe[key] = value
        return safe



class BaseMod:
    name = "base"
    def register(self, bus: EventBus) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class SysSimulationMod(BaseMod):
    name = "sys_simulation"
    def register(self, bus: EventBus) -> None:
        bus.subscribe("simulation.before", self.before)
        bus.subscribe("simulation.after", self.after)
    def before(self, context: StrategyContext, payload: Dict[str, Any]) -> None:
        context.state["simulation_started"] = True
    def after(self, context: StrategyContext, payload: Dict[str, Any]) -> None:
        context.state["simulation_finished"] = True


class SysRiskMod(BaseMod):
    name = "sys_risk"
    def register(self, bus: EventBus) -> None:
        bus.subscribe("strategy.loaded", self.validate_strategy)
        bus.subscribe("simulation.before", self.validate_cash)
    def validate_strategy(self, context: StrategyContext, payload: Dict[str, Any]) -> None:
        code = payload.get("code", "")
        forbidden = ["socket", "requests", "subprocess", "os.system"]
        hit = next((item for item in forbidden if item in code), None)
        if hit:
            raise PermissionError(f"strategy uses forbidden API: {hit}")
    def validate_cash(self, context: StrategyContext, payload: Dict[str, Any]) -> None:
        if context.initial_cash <= 0:
            raise ValueError("initial_cash must be positive")


class SysAnalyserMod(BaseMod):
    name = "sys_analyser"
    def register(self, bus: EventBus) -> None:
        bus.subscribe("analysis.after", self.after)
    def after(self, context: StrategyContext, payload: Dict[str, Any]) -> None:
        result = payload.get("result", {})
        result["mod_chain"] = ["StrategyContext", "EventBus", "sys_simulation", "sys_risk", "sys_analyser"]


class QuantAgentRqalphaModAdapter:
    def __init__(self, mods: List[BaseMod] | None = None):
        self.context: StrategyContext | None = None
        self.bus = EventBus()
        self.mods = mods or [SysSimulationMod(), SysRiskMod(), SysAnalyserMod()]
        for mod in self.mods:
            mod.register(self.bus)

    def start(self, context: StrategyContext) -> None:
        self.context = context
        self.bus.publish("context.created", context, {"mods": [mod.name for mod in self.mods]})

    def strategy_loaded(self, code: str) -> None:
        self._publish("strategy.loaded", {"code": code})

    def before_simulation(self, bars_count: int) -> None:
        self._publish("simulation.before", {"bars_count": bars_count})

    def after_simulation(self, result: Dict[str, Any]) -> None:
        self._publish("simulation.after", {"result": result})

    def after_analysis(self, result: Dict[str, Any]) -> Dict[str, Any]:
        self._publish("analysis.after", {"result": result})
        result["mod_events"] = self.bus.events
        return result

    def _publish(self, event: str, payload: Dict[str, Any]) -> None:
        if self.context is None:
            raise RuntimeError("adapter.start(context) must be called first")
        self.bus.publish(event, self.context, payload)


def register_default_mods() -> QuantAgentRqalphaModAdapter:
    return QuantAgentRqalphaModAdapter()
