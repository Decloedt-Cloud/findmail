export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type SessionUser = { id: string; email: string; name?: string | null; role: "ADMIN" | "MEMBER" };

export function assertCanAccess(user: { id: string; role: string }, ownerId: string | null | undefined) {
  if (user.role === "ADMIN") return;
  if (ownerId && ownerId === user.id) return;
  throw new ApiError(403, "You do not have access to this resource");
}
