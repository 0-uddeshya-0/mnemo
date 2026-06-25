"use server";
import { assertOwner } from "@/lib/auth/guard";
import { askBrain, type AskResult } from "@/lib/rag";

export async function askAction(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<AskResult> {
  await assertOwner();
  return askBrain(question, history);
}

export type { AskResult };
