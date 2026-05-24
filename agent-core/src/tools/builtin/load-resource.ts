import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { safeResolve } from "../../safe-path.js";
import { defineTool, type AgentTool } from "../index.js";

export type ResourceSource = "file" | "url" | "virtual";
export interface ResourceMetadata { id: string; source: ResourceSource; uri: string; name: string; size: number; sha256: string; summary: string }
export interface LoadResourceParams { source: ResourceSource; uri: string; limit?: number }
export interface LoadResourceDetails extends ResourceMetadata { contentPreview?: string }
export interface ResourceOperations { load(params: LoadResourceParams): Promise<{ metadata: ResourceMetadata; contentPreview?: string }> }

export function createDefaultResourceOperations(cwd = process.cwd(), fetchImpl = fetch): ResourceOperations {
  return {
    async load(params) {
      if (params.source === "virtual") throw new Error("virtual resource source is reserved for host-provided loaders");
      if (params.source === "url") {
        const response = await fetchImpl(params.uri);
        if (!response.ok) throw new Error(`URL load failed: ${response.status}`);
        const text = await response.text();
        return buildResource(params.source, params.uri, text, params.limit ?? 1200);
      }
      const path = safeResolve(cwd, params.uri, "resource path");
      const bytes = await readFile(path);
      const info = await stat(path);
      return buildResource("file", params.uri, bytes.toString("utf8"), params.limit ?? 1200, info.size);
    },
  };
}

export function createLoadResourceTool(operations: ResourceOperations): AgentTool<LoadResourceParams, LoadResourceDetails, ResourceOperations> {
  return defineTool<LoadResourceParams, LoadResourceDetails, ResourceOperations>({
    name: "load_resource",
    description: "Load metadata for a file/Git-repo path or URL. Progressive disclosure: inject metadata and a short preview only; use read for full content.",
    parameters: { type: "object", properties: { source: { type: "string", enum: ["file", "url", "virtual"] }, uri: { type: "string" }, limit: { type: "integer" } }, required: ["source", "uri"], additionalProperties: false },
    operations,
    async execute({ params, operations }) {
      const loaded = await operations!.load(params);
      const details: LoadResourceDetails = { ...loaded.metadata };
      if (loaded.contentPreview !== undefined) details.contentPreview = loaded.contentPreview;
      return { content: [{ type: "text", text: JSON.stringify(loaded, null, 2) }], details };
    },
    renderCall: (p) => `load_resource ${p.source}:${p.uri}`,
  });
}

function buildResource(source: ResourceSource, uri: string, content: string, limit: number, knownSize?: number): { metadata: ResourceMetadata; contentPreview: string } {
  const size = knownSize ?? Buffer.byteLength(content);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const summary = content.split(/\r?\n/).slice(0, 3).join(" ").slice(0, 240);
  return { metadata: { id: sha256.slice(0, 16), source, uri, name: basename(uri), size, sha256, summary }, contentPreview: content.slice(0, limit) };
}
