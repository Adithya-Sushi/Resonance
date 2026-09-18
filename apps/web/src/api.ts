import { QueryClient, useQuery } from "@tanstack/react-query";
export const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15000 } },
});
let csrf = "";
export async function api<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/v1" + url, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (data.csrfToken) csrf = data.csrfToken;
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
export const useApi = <T = any>(
  url: string,
  enabled = true,
  interval?: number,
) =>
  useQuery<T>({
    queryKey: [url],
    queryFn: () => api<T>(url),
    enabled,
    refetchInterval: interval,
  });
export async function refresh() {
  await client.invalidateQueries();
}
