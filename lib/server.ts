import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function authClient(){
  return createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
}

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

export async function signInUser(email:string,password:string){
  const client=authClient();
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error)return {user:null,session:null,error};
  return {user:data.user,session:data.session,error:null};
}

export async function signupUser(email: string, password: string, fullName: string) {
  const client=authClient();
  const {data,error}=await client.auth.signUp({
    email,
    password,
    options:{
      data:{full_name:fullName},
      emailRedirectTo:`${(process.env.SITE_URL || 'https://diversoes-veneza-ingressos.vercel.app').replace(/\/$/,'')}/login`
    }
  });
  if(error) throw error;
  return {
    user:data.user,
    access_token:data.session?.access_token,
    refresh_token:data.session?.refresh_token,
    identities:data.user?.identities||[],
  };
}

export function internalSecret() {
  const value = process.env.SUPABASE_INTERNAL_SECRET;
  if (!value) throw new Error('SUPABASE_INTERNAL_SECRET ausente');
  return value;
}
