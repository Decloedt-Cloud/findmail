import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { ApiError, jsonError, readJson, requireAdmin, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { integrationStatus } from "@/lib/config";
import { prisma } from "@/lib/db";
import { retentionSchema, userSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const user = await requireUser();
    const settings = await prisma.appSetting.findMany();
    return NextResponse.json({
      integrations: integrationStatus(),
      settings: Object.fromEntries(settings.map((setting) => [setting.key, setting.value])),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin();
    const input = retentionSchema.parse(await readJson(request));
    await prisma.$transaction([
      prisma.appSetting.upsert({
        where: { key: "exportRetentionDays" },
        create: { key: "exportRetentionDays", value: String(input.exportRetentionDays) },
        update: { value: String(input.exportRetentionDays) },
      }),
      prisma.appSetting.upsert({
        where: { key: "creatorRetentionDays" },
        create: { key: "creatorRetentionDays", value: String(input.creatorRetentionDays) },
        update: { value: String(input.creatorRetentionDays) },
      }),
    ]);
    await audit(user.id, "settings.retention", "appSetting");
    return NextResponse.json({ saved: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const input = userSchema.parse(await readJson(request));
    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existing) throw new ApiError(409, "A user with that email already exists");
    const created = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        passwordHash: await hash(input.password, 12),
      },
      select: { id: true, email: true, name: true, role: true },
    });
    await audit(admin.id, "user.create", "user", created.id);
    return NextResponse.json({ user: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
