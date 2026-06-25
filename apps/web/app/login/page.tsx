import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { isAuthenticated } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/shell/logo";
import { AuthAtmosphere } from "@/components/auth/auth-atmosphere";
import { getOwnerName } from "@/lib/settings";

/** Stagger helper: the shared `.stagger > *` rule reads `--i` for the entrance delay. */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/");
  let name = "";
  try {
    name = await getOwnerName();
  } catch {
    /* DB not ready — generic welcome */
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 pt-safe pb-safe">
      <AuthAtmosphere />

      <div className="stagger relative z-10 w-full max-w-sm">
        <div className="mb-9 flex flex-col items-center gap-4 text-center">
          <span style={step(0)}>
            <Logo
              size={76}
              className="shadow-[0_18px_50px_-14px_rgba(18,80,74,0.6)] ring-1 ring-white/30"
            />
          </span>

          <div style={step(1)} className="flex flex-col items-center gap-1.5">
            <h1 className="pl-[0.34em] font-mono text-[1.7rem] font-semibold tracking-[0.34em] text-foreground">
              MNEMO
            </h1>
            <p className="text-[12.5px] font-medium tracking-wide text-muted-foreground">
              Neural &amp; Extended Memory Oracle
            </p>
          </div>

          <p style={step(2)} className="max-w-[19rem] text-[15px] leading-relaxed text-foreground/80">
            {name ? `Welcome back, ${name}.` : "Welcome back."} Your second mind has been keeping notes.
          </p>
        </div>

        <div style={step(3)} className="liquid-glass rounded-2xl p-5">
          <LoginForm />
        </div>

        <p
          style={step(4)}
          className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
        >
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          Private to you · runs entirely on your devices
        </p>
      </div>
    </main>
  );
}
