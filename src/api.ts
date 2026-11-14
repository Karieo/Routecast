export async function request<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "Connection failed or timed out. Check your connection and retry.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The Routecast API is unavailable. Start the local development server; production providers are not configured.",
    );
  }
  if (!response.ok)
    throw new Error(data.error ?? "The request failed. Please retry.");
  return data as T;
}
