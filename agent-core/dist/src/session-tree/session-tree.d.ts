import type { ChatMessage } from "../providers/index.js";
export interface SessionEntry {
    id: string;
    parentId?: string;
    type: "message" | "summary";
    message?: ChatMessage;
    summary?: string;
    createdAt: string;
}
export interface SessionState {
    leafId?: string;
    entries: SessionEntry[];
}
export declare class JsonlSessionTree {
    private readonly path;
    private entries;
    private leafId;
    constructor(path: string);
    static open(path: string): Promise<JsonlSessionTree>;
    load(): Promise<void>;
    getLeafId(): string | undefined;
    appendMessage(message: ChatMessage, parentId?: string | undefined): Promise<SessionEntry>;
    buildSessionContext(leafId?: string | undefined): ChatMessage[];
    tree(leafId: string): Promise<void>;
    fork(fromEntryId: string, firstMessage?: ChatMessage): Promise<JsonlSessionTree>;
    clone(targetPath: string, leafId?: string | undefined): Promise<JsonlSessionTree>;
    toJSON(): SessionState;
    private append;
    private branchEntries;
}
