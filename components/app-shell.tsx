"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Compass,
  Download,
  LayoutDashboard,
  ListChecks,
  MailSearch,
  Menu,
  Moon,
  Settings,
  Sun,
  Upload,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { APP_NAME, COMPANY_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/discover", label: "Discover Creators", icon: Compass },
  { href: "/email-finder", label: "Email Finder", icon: MailSearch },
  { href: "/creators", label: "All Creators", icon: Users },
  { href: "/lists", label: "Contact Lists", icon: ListChecks },
  { href: "/import", label: "Import CSV", icon: Upload },
  { href: "/jobs", label: "Processing Jobs", icon: Workflow },
  { href: "/exports", label: "Export History", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  user,
  children,
}: {
  user: { name?: string | null; email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-4 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{COMPANY_NAME}</p>
        <p className="mt-1 text-lg font-semibold tracking-tight">{APP_NAME}</p>
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4">
        <p className="truncate text-sm font-medium">{user.name || user.email}</p>
        <p className="truncate text-xs text-muted-foreground">{user.role === "ADMIN" ? "Administrator" : "Member"}</p>
        <button className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar md:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 border-r bg-sidebar">{sidebar}</div>
        </div>
      ) : null}
      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close menu" : "Open menu"}>
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Toggle color theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
