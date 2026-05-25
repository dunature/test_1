import { type AgentTool } from "../index.js";
export interface MarketBar {
    [key: string]: string | number | null | undefined;
}
export interface FetchDataParams {
    symbol: string;
    start_date: string;
    end_date: string;
    fields?: string[];
    limit?: number;
    offset?: number;
    data_source?: string;
    freq?: string;
}
export interface FetchDataDetails {
    symbol: string;
    start_date: string;
    end_date: string;
    data_source: string;
    returned: number;
    offset: number;
    limit: number;
    truncated: boolean;
}
export interface MarketDataOperations {
    fetchMinuteBars(params: Required<Omit<FetchDataParams, "fields">> & {
        fields?: string[];
    }): Promise<MarketBar[]>;
}
export declare function createTushareOperations(token?: string | undefined, fetchImpl?: typeof fetch): MarketDataOperations;
export declare function createFetchDataTool(operations: MarketDataOperations): AgentTool<FetchDataParams, FetchDataDetails, MarketDataOperations>;
