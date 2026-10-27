export type StoredIcpProfile = {
  name: string;
  description: string;
  interests: string[];
  problems: string[];
  goals: string[];
  useCases: string[];
  productCategories: string[];
};

export type StoredIcpOffer = {
  name: string;
  description: string;
  valueProposition: string | null;
};

function textList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readStoredIcp(snapshot: unknown) {
  const root = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : {};
  const icps = (Array.isArray(root.icps) ? root.icps : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = text(row.name);
    if (!name) return [];
    return [{
      name,
      description: text(row.description),
      interests: textList(row.interests),
      problems: textList(row.problems),
      goals: textList(row.goals),
      useCases: textList(row.useCases),
      productCategories: textList(row.productCategories),
    } satisfies StoredIcpProfile];
  });
  const offers = (Array.isArray(root.offers) ? root.offers : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = text(row.name);
    if (!name) return [];
    const value = text(row.valueProposition);
    return [{
      name,
      description: text(row.description),
      valueProposition: value || null,
    } satisfies StoredIcpOffer];
  });
  return { icps, offers };
}
