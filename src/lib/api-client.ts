async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request gagal (${res.status})`);
  }
  return res.json();
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data?: unknown) => request<T>(url, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: <T>(url: string, data?: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(data ?? {}) }),
  patch: <T>(url: string, data?: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(data ?? {}) }),
  del: <T>(url: string, data?: unknown) => request<T>(url, { method: 'DELETE', ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }),
};
