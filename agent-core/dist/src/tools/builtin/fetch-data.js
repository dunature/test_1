import { defineTool } from "../index.js";
export function createTushareOperations(token = process.env.TUSHARE_TOKEN, fetchImpl = fetch) {
    return {
        async fetchMinuteBars(params) {
            if (!token)
                throw new Error("TUSHARE_TOKEN is required for Tushare data fetches");
            const response = await fetchImpl("http://api.tushare.pro", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ api_name: "stk_mins", token, params: { ts_code: params.symbol, start_date: params.start_date, end_date: params.end_date, freq: params.freq } }),
            });
            if (!response.ok)
                throw new Error(`Tushare request failed: ${response.status}`);
            const json = await response.json();
            if (json.code && json.code !== 0)
                throw new Error(`Tushare error ${json.code}: ${json.msg ?? "unknown"}`);
            const fields = json.data?.fields ?? [];
            const items = json.data?.items ?? [];
            return items.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
        },
    };
}
export function createFetchDataTool(operations) {
    return defineTool({
        name: "fetch_data",
        description: "Fetch minute-level historical market data. Phase 1 uses Tushare; schema stays stable when the provider adapter changes.",
        parameters: { type: "object", properties: { symbol: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, fields: { type: "array", items: { type: "string" } }, limit: { type: "integer" }, offset: { type: "integer" }, data_source: { type: "string" }, freq: { type: "string" } }, required: ["symbol", "start_date", "end_date"], additionalProperties: false },
        operations,
        async execute({ params, operations }) {
            const offset = params.offset ?? 0;
            const limit = params.limit ?? 200;
            if (offset < 0)
                throw new Error("offset must be >= 0");
            if (limit < 1)
                throw new Error("limit must be >= 1");
            const data_source = params.data_source ?? "tushare";
            const freq = params.freq ?? "1min";
            const rows = await operations.fetchMinuteBars({ ...params, data_source, freq, offset, limit });
            const projected = params.fields?.length ? rows.map((row) => Object.fromEntries(params.fields.map((field) => [field, row[field] ?? null]))) : rows;
            const page = projected.slice(offset, offset + limit);
            const truncated = offset + limit < projected.length;
            const hint = truncated ? `\n[truncated: ${projected.length - offset - limit} rows remain; call fetch_data with offset=${offset + limit}]` : "";
            return { content: [{ type: "text", text: `${JSON.stringify(page, null, 2)}${hint}` }], details: { symbol: params.symbol, start_date: params.start_date, end_date: params.end_date, data_source, returned: page.length, offset, limit, truncated } };
        },
        renderCall: (p) => `fetch_data ${p.symbol} ${p.start_date}..${p.end_date}`,
    });
}
