import { isAbsolute, relative, resolve } from "node:path";

export function safeResolve(root: string, targetPath: string, label = "path"): string {
  const rootPath = resolve(root);
  const resolved = resolve(rootPath, targetPath);
  const rel = relative(rootPath, resolved);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return resolved;
  throw new Error(`${label} escapes root: ${targetPath}`);
}
