import { type AgentTool } from "../index.js";
export interface FileToolOperations {
    readFile(path: string): Promise<Buffer>;
    writeFile(path: string, content: string): Promise<void>;
    mkdir(path: string): Promise<void>;
}
export declare function createNodeFileOperations(cwd?: string): FileToolOperations;
export interface ReadParams {
    path: string;
    offset?: number;
    limit?: number;
}
export interface ReadDetails {
    path: string;
    offset: number;
    limit: number;
    totalLines?: number;
    truncated: boolean;
    mimeType?: string;
}
export declare function createReadTool(operations: FileToolOperations): AgentTool<ReadParams, ReadDetails, FileToolOperations>;
export interface EditParams {
    path: string;
    oldText: string;
    newText: string;
}
export interface EditDetails {
    path: string;
    replacements: number;
    diff: string;
}
export declare function createEditTool(operations: FileToolOperations): AgentTool<EditParams, EditDetails, FileToolOperations>;
export interface WriteParams {
    path: string;
    content: string;
}
export interface WriteDetails {
    path: string;
    bytes: number;
}
export declare function createWriteTool(operations: FileToolOperations): AgentTool<WriteParams, WriteDetails, FileToolOperations>;
