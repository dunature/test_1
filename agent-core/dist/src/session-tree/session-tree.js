import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export class JsonlSessionTree {
    path;
    entries = new Map();
    leafId;
    constructor(path) {
        this.path = path;
    }
    static async open(path) {
        const tree = new JsonlSessionTree(path);
        await tree.load();
        return tree;
    }
    async load() {
        this.entries.clear();
        try {
            const raw = await readFile(this.path, "utf8");
            for (const line of raw.split(/\r?\n/)) {
                if (!line.trim())
                    continue;
                const entry = JSON.parse(line);
                this.entries.set(entry.id, entry);
                this.leafId = entry.id;
            }
        }
        catch (error) {
            if (error?.code !== "ENOENT")
                throw error;
        }
    }
    getLeafId() { return this.leafId; }
    async appendMessage(message, parentId = this.leafId) {
        const entry = { id: crypto.randomUUID(), type: "message", message, createdAt: new Date().toISOString() };
        if (parentId !== undefined)
            entry.parentId = parentId;
        await this.append(entry);
        this.leafId = entry.id;
        return entry;
    }
    buildSessionContext(leafId = this.leafId) {
        if (!leafId)
            return [];
        const path = [];
        let current = leafId;
        while (current) {
            const entry = this.entries.get(current);
            if (!entry)
                throw new Error(`Missing session entry: ${current}`);
            path.push(entry);
            current = entry.parentId;
        }
        return path.reverse().flatMap((entry) => entry.message ? [entry.message] : []);
    }
    async tree(leafId) {
        if (!this.entries.has(leafId))
            throw new Error(`Unknown leafId: ${leafId}`);
        this.leafId = leafId;
    }
    async fork(fromEntryId, firstMessage) {
        if (!this.entries.has(fromEntryId))
            throw new Error(`Unknown fork entry: ${fromEntryId}`);
        this.leafId = fromEntryId;
        if (firstMessage)
            await this.appendMessage(firstMessage, fromEntryId);
        return this;
    }
    async clone(targetPath, leafId = this.leafId) {
        const clone = new JsonlSessionTree(targetPath);
        await mkdir(dirname(targetPath), { recursive: true });
        const branch = this.branchEntries(leafId);
        await writeFile(targetPath, branch.map((entry) => JSON.stringify(entry)).join("\n") + (branch.length ? "\n" : ""), "utf8");
        await clone.load();
        return clone;
    }
    toJSON() { const state = { entries: [...this.entries.values()] }; if (this.leafId !== undefined)
        state.leafId = this.leafId; return state; }
    async append(entry) {
        await mkdir(dirname(this.path), { recursive: true });
        this.entries.set(entry.id, entry);
        await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    }
    branchEntries(leafId = this.leafId) {
        if (!leafId)
            return [];
        const out = [];
        let current = leafId;
        while (current) {
            const entry = this.entries.get(current);
            if (!entry)
                throw new Error(`Missing session entry: ${current}`);
            out.push(entry);
            current = entry.parentId;
        }
        return out.reverse();
    }
}
