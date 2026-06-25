import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth/session";

/** Redirect to /login unless the owner session is present. Server-only. */
export async function requireOwner(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Throw (don't redirect) unless the owner session is present — for server actions / routes. */
export async function assertOwner(): Promise<void> {
  if (!(await isAuthenticated())) throw new Error("Unauthorized");
}
