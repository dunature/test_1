import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatMessage } from "../providers/index.js";

export interface SessionEntry { id: string; parentId?: string; type: "message" | "summary"; message?: ChatMessage; summary?: string; createdAt: string }
export interface SessionState { leafId?: string; entries: SessionEntry[] }

export class JsonlSessionTree {
  private entries = new Map<string, SessionEntry>();
  private leafId: string | undefined;

  constructor(private readonly path: string) {}

  static async open(path: string): Promise<JsonlSessionTree> {
    const tree = new JsonlSessionTree(path);
    await tree.load();
    return tree;
  }

  async load(): Promise<void> {
    this.entries.clear();
    try {
      const raw = await readFile(this.path, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as SessionEntry;
        this.entries.set(entry.id, entry);
        this.leafId = entry.id;
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  getLeafId(): string | undefined { return this.leafId; }

  async appendMessage(message: ChatMessage, parentId = this.leafId): Promise<SessionEntry> {
    const entry: SessionEntry = { id: crypto.randomUUID(), type: "message", message, createdAt: new Date().toISOString() };
    if (parentId !== undefined) entry.parentId = parentId;
    await this.append(entry);
    this.leafId = entry.id;
    return entry;
  }

  buildSessionContext(leafId = this.leafId): ChatMessage[] {
    if (!leafId) return [];
    const path: SessionEntry[] = [];
    let current: string | undefined = leafId;
    while (current) {
      const entry = this.entries.get(current);
      if (!entry) throw new Error(`Missing session entry: ${current}`);
      path.push(entry);
      current = entry.parentId;
    }
    return path.reverse().flatMap((entry) => entry.message ? [entry.message] : []);
  }

  async tree(leafId: string): Promise<void> {
    if (!this.entries.has(leafId)) throw new Error(`Unknown leafId: ${leafId}`);
    this.leafId = leafId;
  }

  async fork(fromEntryId: string, firstMessage?: ChatMessage): Promise<JsonlSessionTree> {
    if (!this.entries.has(fromEntryId)) throw new Error(`Unknown fork entry: ${fromEntryId}`);
    this.leafId = fromEntryId;
    if (firstMessage) await this.appendMessage(firstMessage, fromEntryId);
    return this;
  }

  async clone(targetPath: string, leafId = this.leafId): Promise<JsonlSessionTree> {
    const clone = new JsonlSessionTree(targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    const branch = this.branchEntries(leafId);
    await writeFile(targetPath, branch.map((entry) => JSON.stringify(entry)).join("\n") + (branch.length ? "\n" : ""), "utf8");
    await clone.load();
    return clone;
  }

  toJSON(): SessionState { const state: SessionState = { entries: [...this.entries.values()] }; if (this.leafId !== undefined) state.leafId = this.leafId; return state; }

  private async append(entry: SessionEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.entries.set(entry.id, entry);
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private branchEntries(leafId = this.leafId): SessionEntry[] {
    if (!leafId) return [];
    const out: SessionEntry[] = [];
    let current: string | undefined = leafId;
    while (current) {
      const entry = this.entries.get(current);
      if (!entry) throw new Error(`Missing session entry: ${current}`);
      out.push(entry);
      current = entry.parentId;
    }
    return out.reverse();
  }
}
