"use server";
import { assertOwner } from "@/lib/auth/guard";
import {
  answerInterview,
  skipQuestion,
  startInterview,
  type AnswerResult,
  type InterviewStart,
  type NextQuestion,
} from "@/lib/interview";
import type { InterviewPhase } from "@/lib/graph/constants";

export async function startInterviewAction(): Promise<InterviewStart> {
  await assertOwner();
  return startInterview();
}

export async function answerInterviewAction(
  phase: InterviewPhase,
  question: string,
  answer: string,
): Promise<AnswerResult> {
  await assertOwner();
  return answerInterview(phase, question, answer);
}

export async function skipQuestionAction(
  phase: InterviewPhase,
  question: string,
): Promise<NextQuestion> {
  await assertOwner();
  return skipQuestion(phase, question);
}
