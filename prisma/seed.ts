import "../lib/load-env";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!email || !password || password.length < 8) {
    throw new Error("Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 8 characters before seeding.");
  }
  const passwordHash = await hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", name: "Wayo Ads Admin" },
    create: { email, passwordHash, role: "ADMIN", name: "Wayo Ads Admin" },
  });
  await prisma.appSetting.upsert({
    where: { key: "exportRetentionDays" },
    update: {},
    create: { key: "exportRetentionDays", value: "30" },
  });
  await prisma.appSetting.upsert({
    where: { key: "creatorRetentionDays" },
    update: {},
    create: { key: "creatorRetentionDays", value: "0" },
  });
  console.log(`Seeded admin ${email}. No sample creators were created.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
