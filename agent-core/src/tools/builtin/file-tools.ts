import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { safeResolve } from "../../safe-path.js";
import { defineTool, type AgentTool } from "../index.js";

export interface FileToolOperations {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export function createNodeFileOperations(cwd = process.cwd()): FileToolOperations {
  const safe = (path: string) => safeResolve(cwd, path, "file path");
  return {
    readFile: (path) => readFile(safe(path)),
    async writeFile(path, content) { await writeFile(safe(path), content, "utf8"); },
    async mkdir(path) { await mkdir(safe(path), { recursive: true }); },
  };
}

export interface ReadParams { path: string; offset?: number; limit?: number }
export interface ReadDetails { path: string; offset: number; limit: number; totalLines?: number; truncated: boolean; mimeType?: string }

export function createReadTool(operations: FileToolOperations): AgentTool<ReadParams, ReadDetails, FileToolOperations> {
  return defineTool<ReadParams, ReadDetails, FileToolOperations>({
    name: "read",
    description: "Read a text file with 1-indexed line offset/limit pagination, or return an image payload for supported image files.",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, required: ["path"], additionalProperties: false },
    operations,
    renderCall: (p) => `read ${p.path}${p.offset ? `:${p.offset}` : ""}`,
    renderResult: (r) => r.content.map((c) => c.type === "text" ? c.text : `[image:${c.mimeType}]`).join("\n"),
    async execute({ params, operations }) {
      const offset = params.offset ?? 1;
      const limit = params.limit ?? 200;
      if (offset < 1) throw new Error("offset must be 1-indexed and >= 1");
      if (limit < 1) throw new Error("limit must be >= 1");
      const data = await operations!.readFile(params.path);
      const mimeType = imageMimeType(params.path);
      if (mimeType) return { content: [{ type: "image", mimeType, data: data.toString("base64") }], details: { path: params.path, offset, limit, truncated: false, mimeType } };
      const lines = data.toString("utf8").split(/\r?\n/);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const truncated = offset - 1 + limit < lines.length;
      const numbered = slice.map((line, i) => `${offset + i}: ${line}`).join("\n");
      const text = truncated ? `${numbered}\n\n[truncated: ${lines.length - (offset - 1 + limit)} lines remain; call read with offset=${offset + limit}]` : numbered;
      return { content: [{ type: "text", text }], details: { path: params.path, offset, limit, totalLines: lines.length, truncated } };
    },
  });
}

export interface EditParams { path: string; oldText: string; newText: string }
export interface EditDetails { path: string; replacements: number; diff: string }

export function createEditTool(operations: FileToolOperations): AgentTool<EditParams, EditDetails, FileToolOperations> {
  return defineTool<EditParams, EditDetails, FileToolOperations>({
    name: "edit",
    description: "Apply an exact oldText/newText local edit. The oldText must occur exactly once. Returns a small patch preview.",
    parameters: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"], additionalProperties: false },
    operations,
    async execute({ params, operations }) {
      const before = (await operations!.readFile(params.path)).toString("utf8");
      const count = before.split(params.oldText).length - 1;
      if (count !== 1) throw new Error(`oldText must occur exactly once; found ${count}`);
      const after = before.replace(params.oldText, params.newText);
      await operations!.writeFile(params.path, after);
      const diff = makeSimpleDiff(params.oldText, params.newText);
      return { content: [{ type: "text", text: `Edited ${params.path}\n${diff}` }], details: { path: params.path, replacements: 1, diff } };
    },
    renderCall: (p) => `edit ${p.path}`,
  });
}

export interface WriteParams { path: string; content: string }
export interface WriteDetails { path: string; bytes: number }

export function createWriteTool(operations: FileToolOperations): AgentTool<WriteParams, WriteDetails, FileToolOperations> {
  return defineTool<WriteParams, WriteDetails, FileToolOperations>({
    name: "write",
    description: "Create a new file or fully rewrite an existing file, creating parent directories automatically.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    operations,
    async execute({ params, operations }) {
      await operations!.mkdir(dirname(params.path));
      await operations!.writeFile(params.path, params.content);
      return { content: [{ type: "text", text: `Wrote ${params.path} (${Buffer.byteLength(params.content)} bytes)` }], details: { path: params.path, bytes: Buffer.byteLength(params.content) } };
    },
    renderCall: (p) => `write ${p.path}`,
  });
}

function imageMimeType(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return undefined;
}

function makeSimpleDiff(oldText: string, newText: string): string {
  return [`--- old`, `+++ new`, ...oldText.split(/\r?\n/).map((l) => `-${l}`), ...newText.split(/\r?\n/).map((l) => `+${l}`)].join("\n");
}
