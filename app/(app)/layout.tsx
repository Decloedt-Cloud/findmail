import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/feedback";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-14 w-full" /></div>}>
      <Authed>{children}</Authed>
    </Suspense>
  );
}

async function Authed({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <AppShell user={{ name: session.user.name, email: session.user.email, role: session.user.role }}>
      {children}
    </AppShell>
  );
}
