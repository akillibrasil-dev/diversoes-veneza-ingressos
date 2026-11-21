import crypto from 'crypto';
import { internalSecret, rpc } from './server';

const API = 'https://api.mercadopago.com';

export type MpConnection = {
  tenant_id: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  provider_user_id?: string | null;
};

export async function exchangeAuthorizationCode(code: string) {
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  const redirectUri = `${process.env.SITE_URL}/api/mercadopago/callback`;
  if (!clientId || !clientSecret) throw new Error('Mercado Pago ainda não configurado');
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data as {
    access_token: string;
    refresh_token?: string;
    public_key?: string;
    user_id: number | string;
    expires_in?: number;
  };
}

export async function refreshMpToken(conn: MpConnection): Promise<MpConnection> {
  if (!conn.refresh_token) return conn;
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return conn;
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) return conn;
  const data = await res.json();
  const expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
  await rpc('internal_update_mp_tokens', {
    p_secret: internalSecret(),
    p_tenant: conn.tenant_id,
    p_access_token: data.access_token,
    p_refresh_token: data.refresh_token || conn.refresh_token,
    p_expires_at: expiresAt,
  });
  return { ...conn, access_token: data.access_token, refresh_token: data.refresh_token || conn.refresh_token, expires_at: expiresAt };
}

export async function ensureFreshToken(conn: MpConnection) {
  if (!conn.expires_at) return conn;
  const expires = new Date(conn.expires_at).getTime();
  if (expires - Date.now() > 10 * 60 * 1000) return conn;
  return refreshMpToken(conn);
}

export async function mpGet(path: string, token: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function listPointTerminals(token:string){
  return mpGet('/terminals/v1/list?limit=50&offset=0',token);
}

export async function getPointOrder(orderId:string,token:string){
  return mpGet(`/v1/orders/${encodeURIComponent(orderId)}`,token);
}

export async function createPointOrder(ctx:any,terminalId:string){
  const body={
    type:'point',
    external_reference:String(ctx.order_id),
    transactions:{payments:[{amount:(Number(ctx.total_cents)/100).toFixed(2)}]},
    config:{point:{terminal_id:terminalId,print_on_terminal:'no_ticket'}},
    description:'Diversões Veneza - ingressos',
    expiration_time:'PT5M'
  };
  const res=await fetch(`${API}/v1/orders`,{
    method:'POST',
    headers:{
      Authorization:`Bearer ${ctx.access_token}`,
      'Content-Type':'application/json',
      'X-Idempotency-Key':String(ctx.payment_request_key||crypto.randomUUID())
    },
    body:JSON.stringify(body)
  });
  const data=await res.json();
  if(!res.ok)throw new Error(JSON.stringify(data));
  return data;
}

// Mantido apenas como trilha experimental para a rota /online.
export async function createMpOrder(ctx: any, returnUrl: string) {
  const token = ctx.access_token as string;
  const body = {
    type: 'online',
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    total_amount: (ctx.total_cents / 100).toFixed(2),
    external_reference: ctx.order_id,
    description: 'Ingressos Diversões Veneza',
    config: {
      statement_descriptor: 'DIVERSOES VENEZA',
      online: {
        success_url: returnUrl,
        failure_url: returnUrl,
        pending_url: returnUrl,
        auto_return: 'approved',
      },
    },
    payer: ctx.buyer_email ? { email: ctx.buyer_email } : undefined,
    items: (ctx.items || []).map((item: any) => ({
      external_code: item.id,
      title: item.title,
      quantity: item.quantity,
      unit_price: Number(item.unit_price).toFixed(2),
    })),
  };
  const res = await fetch(`${API}/v1/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data as { id: string; checkout_url: string; status: string };
}

export async function setupPointTerminal(token:string,terminalId:string){
  const res=await fetch(`${API}/terminals/v1/setup`,{
    method:'PATCH',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({terminals:[{id:terminalId,operating_mode:'PDV'}]})
  });
  const data=await res.json();
  if(!res.ok)throw new Error(JSON.stringify(data));
  return data;
}
