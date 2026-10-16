import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";

class LoginRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(8).max(200),
          })
          .safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
        const limit = await rateLimit(`login:${email}:${ip}`, 10, 15 * 60 * 1000, getRedis());
        if (!limit.ok) throw new LoginRateLimited();
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const matches = await compare(parsed.data.password, user.passwordHash);
        if (!matches) return null;
        await audit(user.id, "auth.login", "user", user.id);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = user.role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role === "ADMIN" ? "ADMIN" : "MEMBER";
      }
      return session;
    },
  },
});
