import { NextResponse } from 'next/server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let database = false;
  let products = 0;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/products?select=id&active=eq.true`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        database = true;
        products = Array.isArray(data) ? data.length : 0;
      }
    } catch {}
  }
  return NextResponse.json({
    app: true,
    database,
    products,
    mercadoPagoApp: Boolean(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET),
    webhookSignature: Boolean(process.env.MP_WEBHOOK_SECRET),
    pointOrders: true,
    physicalPrinting: true,
    tenant: process.env.NEXT_PUBLIC_TENANT_SLUG || 'diversoes-veneza',
    siteUrl: process.env.SITE_URL || null,
  });
}
