const SENSITIVE = /email|password|secret|token|api[_-]?key|authorization/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      output[key] = SENSITIVE.test(key) ? "[redacted]" : redact(inner, depth + 1);
    }
    return output;
  }
  return value;
}

function write(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...(extra ? (redact(extra) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info(msg: string, extra?: Record<string, unknown>) {
    write("info", msg, extra);
  },
  warn(msg: string, extra?: Record<string, unknown>) {
    write("warn", msg, extra);
  },
  error(msg: string, extra?: Record<string, unknown>) {
    write("error", msg, extra);
  },
};
