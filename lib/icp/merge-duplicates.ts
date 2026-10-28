import type { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { icpHost, icpIdentityKey } from "@/lib/icp/identity";

const ACTIVE = new Set<JobStatus>(["QUEUED", "RUNNING"]);

type IcpRow = {
  id: string;
  brandName: string;
  websiteUrl: string;
  status: JobStatus;
  matchedChannelCount: number;
  createdAt: Date;
  channelCount: number;
};

function rank(row: IcpRow) {
  const active = ACTIVE.has(row.status) ? 1 : 0;
  const completed = row.status === "COMPLETED" || row.status === "PARTIALLY_COMPLETED" ? 1 : 0;
  return [active, completed, row.channelCount, row.createdAt.getTime()] as const;
}

/** One row to keep. A search still running is never deleted. */
export function chooseIcpMerge(rows: IcpRow[]) {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return 0;
  });
  const keep = sorted[0];
  const drop = sorted.slice(1).filter((row) => !ACTIVE.has(row.status));
  if (drop.length === 0) return null;
  return { keep, drop };
}

export async function mergeDuplicateBrandIcps() {
  const rows = await prisma.brandIcp.findMany({
    select: {
      id: true,
      brandName: true,
      websiteUrl: true,
      status: true,
      matchedChannelCount: true,
      createdAt: true,
      _count: { select: { channels: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const groups = new Map<string, IcpRow[]>();
  for (const row of rows) {
    const key = icpIdentityKey(row.brandName, row.websiteUrl);
    const list = groups.get(key) ?? [];
    list.push({
      id: row.id,
      brandName: row.brandName,
      websiteUrl: row.websiteUrl,
      status: row.status,
      matchedChannelCount: row.matchedChannelCount,
      createdAt: row.createdAt,
      channelCount: row._count.channels,
    });
    groups.set(key, list);
  }

  const merged: { brandName: string; host: string; keptId: string; removed: number; creatorsMoved: number }[] = [];
  for (const group of groups.values()) {
    const choice = chooseIcpMerge(group);
    if (!choice) continue;
    const dropIds = choice.drop.map((row) => row.id);
    const creatorsMoved = await prisma.$transaction(async (tx) => {
      const [keptLinks, incoming] = await Promise.all([
        tx.icpChannelMatch.findMany({ where: { brandIcpId: choice.keep.id }, select: { creatorId: true } }),
        tx.icpChannelMatch.findMany({ where: { brandIcpId: { in: dropIds } }, select: { creatorId: true } }),
      ]);
      const have = new Set(keptLinks.map((link) => link.creatorId));
      const add = [...new Set(incoming.map((link) => link.creatorId))].filter((id) => !have.has(id));
      if (add.length > 0) {
        await tx.icpChannelMatch.createMany({
          data: add.map((creatorId) => ({ brandIcpId: choice.keep.id, creatorId })),
          skipDuplicates: true,
        });
      }
      await tx.brandIcp.deleteMany({ where: { id: { in: dropIds } } });
      const channelCount = await tx.icpChannelMatch.count({ where: { brandIcpId: choice.keep.id } });
      await tx.brandIcp.update({
        where: { id: choice.keep.id },
        data: { matchedChannelCount: channelCount },
      });
      return add.length;
    });
    merged.push({
      brandName: choice.keep.brandName,
      host: icpHost(choice.keep.websiteUrl),
      keptId: choice.keep.id,
      removed: dropIds.length,
      creatorsMoved,
    });
  }
  return merged;
}
