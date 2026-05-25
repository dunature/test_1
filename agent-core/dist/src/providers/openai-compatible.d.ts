import type { ProviderAdapter, StreamEvent, StreamRequest } from "./types.js";
interface FetchLike {
    (input: string | URL, init?: RequestInit): Promise<Response>;
}
export declare class OpenAICompatibleAdapter implements ProviderAdapter {
    private readonly fetchImpl;
    readonly id: string;
    constructor(providerId?: string, fetchImpl?: FetchLike);
    stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}
export {};
