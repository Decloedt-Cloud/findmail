const DISALLOW_USER_AGENTS = ["wayoadscreatoremailfinder", "*"];

export type RobotRules = {
  disallow: string[];
  allow: string[];
};

export function parseRobots(body: string, userAgent: string): RobotRules {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || current.disallow.length > 0 || current.allow.length > 0) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow" && current) {
      if (value) current.disallow.push(value);
    } else if (field === "allow" && current) {
      if (value) current.allow.push(value);
    }
  }

  const token = userAgent.toLowerCase();
  const specific = groups.find((group) => group.agents.some((agent) => agent !== "*" && token.includes(agent)));
  const fallback = groups.find((group) => group.agents.includes("*"));
  const chosen = specific ?? fallback;
  return { disallow: chosen?.disallow ?? [], allow: chosen?.allow ?? [] };
}

export function pathAllowedByRobots(pathname: string, rules: RobotRules): boolean {
  const path = pathname || "/";
  const matches = (rule: string) => {
    if (rule === "/") return true;
    return path.startsWith(rule);
  };
  const allowLength = rules.allow.filter(matches).reduce((max, rule) => Math.max(max, rule.length), -1);
  const disallowLength = rules.disallow.filter(matches).reduce((max, rule) => Math.max(max, rule.length), -1);
  if (disallowLength === -1) return true;
  return allowLength >= disallowLength;
}

export { DISALLOW_USER_AGENTS };
