const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function rpc<T = unknown>(fn: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase RPC ${fn} failed`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function verifyAccessToken(token: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ id: string; email?: string }>;
}

export async function signupUser(email: string, password: string, fullName: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { full_name: fullName } }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || data?.message || 'Falha ao criar usuário');
  return data as { user?: { id: string; email?: string } };
}

export function internalSecret() {
  const value = process.env.SUPABASE_INTERNAL_SECRET;
  if (!value) throw new Error('SUPABASE_INTERNAL_SECRET ausente');
  return value;
}
