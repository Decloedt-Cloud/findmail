import { NextResponse } from "next/server";
import { wayoAdsOpenApi } from "@/lib/integrations/openapi";

export function GET() {
  return NextResponse.json(wayoAdsOpenApi);
}
