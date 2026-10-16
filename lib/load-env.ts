import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code !== "ENOENT") throw error;
}
