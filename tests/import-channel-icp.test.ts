import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportRow } from "@/lib/csv";
import { importRow } from "@/lib/jobs/import";
import { writeChannelIcp } from "@/lib/icp/channel-icp";
import { createYouTubeClient } from "@/lib/youtube/client";

const db = vi.hoisted(() => ({
  prisma: {
    creator: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    dedupEvent: { create: vi.fn() },
    emailContact: { findUnique: vi.fn(), create: vi.fn() },
    apiUsage: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: db.prisma,
  isUniqueViolation: () => false,
}));

vi.mock("@/lib/icp/channel-icp", () => ({
  writeChannelIcp: vi.fn(),
}));

vi.mock("@/lib/youtube/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube/client")>()),
  createYouTubeClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/jobs/progress", () => ({
  isCancelled: vi.fn(),
  markRunning: vi.fn(),
  recordJobError: vi.fn(),
  refreshJobCounts: vi.fn(),
  updateProgress: vi.fn(),
}));

vi.mock("@/lib/paths", () => ({
  ensureDataDirs: vi.fn(),
  paths: { imports: "/tmp", uploads: "/tmp" },
}));

const CHANNEL_ID = "UCsyWQ6m4lbfir1Z3deNAIcw";

const row: ImportRow = {
  rowNumber: 2,
  channelId: null,
  channelName: "Salut Les Noobs",
  channelUrl: `https://www.youtube.com/channel/${CHANNEL_ID}`,
  videoUrl: null,
  country: "FR",
  subscriberCount: 95700,
  websiteUrl: null,
  email: null,
};

const profile = {
  name: "Gamers francophones",
  description: "Joueurs francophones.",
  interests: ["jeux vidéo"],
  problems: [],
  goals: [],
  useCases: [],
  productCategories: [],
};

const youtube = {
  listChannels: vi.fn(),
  channelForHandle: vi.fn(),
  channelIdForVideo: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createYouTubeClient).mockReturnValue(youtube as unknown as ReturnType<typeof createYouTubeClient>);
  vi.mocked(writeChannelIcp).mockResolvedValue(profile);
  youtube.listChannels.mockResolvedValue([
    {
      id: CHANNEL_ID,
      title: "Salut Les Noobs",
      description: "Chaîne de jeux vidéo.",
      customUrl: "@saluslesnoobs",
      country: "FR",
      subscriberCount: 95700,
      keywords: ["jeux", "noobs"],
      thumbnailUrl: null,
      defaultLanguage: null,
      subscriberVisibility: "PUBLIC",
      videoCount: 10,
      viewCount: "1000",
      uploadsPlaylistId: null,
    },
  ]);
  db.prisma.dedupEvent.create.mockResolvedValue({});
  db.prisma.apiUsage.create.mockResolvedValue({});
});

describe("CSV import builds the channel ICP", () => {
  it("stores a channel ICP on a new creator, built from YouTube details", async () => {
    db.prisma.creator.findUnique.mockResolvedValue(null);
    db.prisma.creator.create.mockResolvedValue({ id: "c1" });

    await importRow(row, "SKIP");

    expect(youtube.listChannels).toHaveBeenCalledWith([CHANNEL_ID]);
    expect(writeChannelIcp).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHANNEL_ID, description: "Chaîne de jeux vidéo.", keywords: ["jeux", "noobs"] }),
    );
    expect(db.prisma.creator.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channelIcp: profile }) }),
    );
  });

  it("fills the ICP of an existing creator that has none, even with SKIP", async () => {
    db.prisma.creator.findUnique.mockResolvedValue({ id: "c1", channelIcp: null, channelName: "Salut Les Noobs" });

    const result = await importRow(row, "SKIP");

    expect(result.duplicate).toBe(true);
    expect(writeChannelIcp).toHaveBeenCalledTimes(1);
    expect(db.prisma.creator.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { channelIcp: profile } });
    expect(db.prisma.creator.create).not.toHaveBeenCalled();
  });

  it("does not recompute the ICP of an existing creator that already has one under SKIP", async () => {
    db.prisma.creator.findUnique.mockResolvedValue({ id: "c1", channelIcp: profile, channelName: "Salut Les Noobs" });

    const result = await importRow(row, "SKIP");

    expect(result.duplicate).toBe(true);
    expect(writeChannelIcp).not.toHaveBeenCalled();
    expect(db.prisma.creator.update).not.toHaveBeenCalled();
  });
});
