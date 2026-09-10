export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  data?: Record<string, unknown>;
} | null;
