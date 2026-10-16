import { mkdir } from "node:fs/promises";
import path from "node:path";

export const dataRoot = path.join(process.cwd(), "data");

export const paths = {
  uploads: path.join(dataRoot, "uploads"),
  exports: path.join(dataRoot, "exports"),
  imports: path.join(dataRoot, "imports"),
  postgres: path.join(dataRoot, "postgres"),
};

export async function ensureDataDirs() {
  await Promise.all(Object.values(paths).map((dir) => mkdir(dir, { recursive: true })));
}

export function insideDir(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}
