export const MISSING_OPENROUTER_API_KEY_MESSAGE =
  "Missing OpenRouter API key. Send Authorization: Bearer <key>.";

export function getOpenRouterApiKey(headers: Headers) {
  const authorization = headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, ...valueParts] = authorization.split(" ");
  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const token = valueParts.join(" ").trim();
  return token || null;
}
