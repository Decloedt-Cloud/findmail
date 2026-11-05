import type { NormalizedCompanyLead } from "@/lib/company-leads/normalize";

const PREFERRED_TITLE =
  /\b(marketing|brand|founder|co-?founder|owner|ceo|cmo|president|growth|partnership|influencer|creator|digital|advertis|media|ecommerce|e-commerce|social|content|merchandis|sales\s*director|vp\b|vice\s*president)\b/i;

export type CompanyLeadSampleOptions = {
  max: number;
  maxPerSic: number;
  maxPerState: number;
};

export const DEFAULT_COMPANY_LEAD_SAMPLE: CompanyLeadSampleOptions = {
  max: 50_000,
  maxPerSic: 120,
  maxPerState: 1_500,
};

export function isPreferredCompanyLeadTitle(title: string | null | undefined): boolean {
  return Boolean(title && PREFERRED_TITLE.test(title));
}

export function companyLeadSicKey(lead: Pick<NormalizedCompanyLead, "sicCode" | "sicName">): string {
  return (lead.sicCode || lead.sicName || "unknown").trim().toLowerCase() || "unknown";
}

export function companyLeadStateKey(lead: Pick<NormalizedCompanyLead, "mailingState">): string {
  return (lead.mailingState || "XX").trim().toUpperCase() || "XX";
}

export class CompanyLeadSampleBudget {
  readonly options: CompanyLeadSampleOptions;
  private readonly emails = new Set<string>();
  private readonly sicCounts = new Map<string, number>();
  private readonly stateCounts = new Map<string, number>();
  private readonly preferred: NormalizedCompanyLead[] = [];
  private readonly filler: NormalizedCompanyLead[] = [];

  constructor(options: Partial<CompanyLeadSampleOptions> = {}) {
    this.options = { ...DEFAULT_COMPANY_LEAD_SAMPLE, ...options };
  }

  get size(): number {
    return this.preferred.length + this.filler.length;
  }

  get full(): boolean {
    return this.size >= this.options.max;
  }

  private preferredCap(): number {
    return Math.floor(this.options.max * 0.7);
  }

  consider(lead: NormalizedCompanyLead): boolean {
    if (this.full) return false;
    if (!lead.domain) return false;
    if (this.emails.has(lead.emailNormalized)) return false;

    const sic = companyLeadSicKey(lead);
    const state = companyLeadStateKey(lead);
    if ((this.sicCounts.get(sic) ?? 0) >= this.options.maxPerSic) return false;
    if ((this.stateCounts.get(state) ?? 0) >= this.options.maxPerState) return false;

    const preferred = isPreferredCompanyLeadTitle(lead.title);
    if (preferred && this.preferred.length < this.preferredCap()) {
      this.preferred.push(lead);
    } else if (this.size < this.options.max) {
      this.filler.push(lead);
    } else {
      return false;
    }

    this.emails.add(lead.emailNormalized);
    this.sicCounts.set(sic, (this.sicCounts.get(sic) ?? 0) + 1);
    this.stateCounts.set(state, (this.stateCounts.get(state) ?? 0) + 1);
    return true;
  }

  selected(): NormalizedCompanyLead[] {
    return [...this.preferred, ...this.filler].slice(0, this.options.max);
  }

  stats() {
    return {
      selected: this.size,
      preferred: this.preferred.length,
      filler: this.filler.length,
      sicBuckets: this.sicCounts.size,
      stateBuckets: this.stateCounts.size,
    };
  }
}
