import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "Request validation failed.",
        code: "invalid_request",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      },
      { status: 400 }
    );
  }

  console.error("Unhandled DropLoop API error", error);
  return Response.json({ error: "Internal server error.", code: "internal_error" }, { status: 500 });
}
