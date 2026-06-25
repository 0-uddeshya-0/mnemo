"use server";
import { redirect } from "next/navigation";
import { login } from "@/lib/auth/session";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter your password." };
  const ok = await login(password);
  if (!ok) return { error: "Incorrect password." };
  redirect("/");
}
