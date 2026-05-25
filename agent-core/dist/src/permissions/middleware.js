const readonlyTools = ["read", "load_resource", "fetch_data"];
const backtestTools = [...readonlyTools, "backtest"];
export const permissionConfigs = {
    readonly: {
        role: "readonly",
        defaultMode: "deny",
        rules: [
            { tools: readonlyTools, mode: "allow" },
            { tools: ["write", "edit", "backtest"], mode: "deny", reason: "permission denied: readonly role cannot mutate files or run backtests" },
        ],
    },
    backtest: {
        role: "backtest",
        defaultMode: "deny",
        rules: [
            { tools: backtestTools, mode: "allow" },
            { tools: ["write", "edit"], mode: "deny", reason: "permission denied: backtest role cannot write or edit files" },
        ],
    },
};
export function createPermissionMiddleware(role, override) {
    const base = permissionConfigs[role];
    const config = {
        role,
        defaultMode: override?.defaultMode ?? base.defaultMode,
        rules: override?.rules ?? base.rules,
    };
    return ({ toolCall }) => {
        for (const rule of config.rules) {
            if (rule.tools.includes(toolCall.name) || rule.tools.includes("*")) {
                return decision(rule.mode, rule.reason);
            }
        }
        return decision(config.defaultMode, `permission denied: ${role} role cannot call ${toolCall.name}`);
    };
}
export function decision(mode, reason) {
    const out = { mode };
    if (reason !== undefined)
        out.reason = reason;
    return out;
}
