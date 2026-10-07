const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export async function api(path, body, method = "POST") {
  const token = sessionStorage.getItem("dispatch-token");
  const response = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The server returned an unexpected response. Check the backend URL.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      [result.error, ...(result.details || [])].filter(Boolean).join("\n") ||
        "Request failed.",
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
