import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureFreshToken, mpGet } from '@/lib/mp';
import { internalSecret, rpc } from '@/lib/server';

function validSignature(req: NextRequest, dataId: string, secret: string) {
  const signature = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(signature.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }));
  const ts = parts.ts;
  const received = parts.v1;
  if (!ts || !received) return false;
  const manifest = `${dataId ? `id:${dataId};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dataId = req.nextUrl.searchParams.get('data.id') || body?.data?.id;
    if (!dataId) return NextResponse.json({ ok: true });

    const secret = process.env.MP_WEBHOOK_SECRET;
    if (secret && !validSignature(req, String(dataId), secret)) {
      return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }

    if (body?.type && body.type !== 'order' && body.type !== 'orders_v2') {
      return NextResponse.json({ ok: true });
    }

    const providerUser = String(body?.user_id || '');
    if (!providerUser) return NextResponse.json({ ok: true });

    let conn: any = await rpc('internal_connection_by_provider_user', {
      p_secret: internalSecret(),
      p_provider_user_id: providerUser,
    });
    if (!conn) return NextResponse.json({ ok: true });
    conn = await ensureFreshToken(conn);

    const order: any = await mpGet(`/v1/orders/${encodeURIComponent(String(dataId))}`, conn.access_token);
    const external = String(order.external_reference || '');
    if (!external) return NextResponse.json({ ok: true });

    if(order.type==='point'){
      const payment=order?.transactions?.payments?.[0]||{};
      const paid=Math.round(Number(order.total_paid_amount||payment.paid_amount||payment.amount||0)*100);
      await rpc('internal_confirm_point_order',{
        p_secret:internalSecret(),p_external_reference:external,p_provider_order_id:String(order.id||dataId),
        p_status:String(order.status||'unknown'),p_status_detail:String(order.status_detail||''),
        p_paid_amount_cents:paid,p_payment_reference:String(payment?.reference?.id||payment?.reference_id||payment?.id||''),
        p_payment_method:String(payment?.payment_method?.type||payment?.payment_method?.id||''),p_raw:order
      });
    }else{
      const status = order.status === 'processed' && order.status_detail === 'accredited' ? 'approved' : String(order.status || 'unknown');
      const paid = Math.round(Number(order.total_paid_amount || 0) * 100);
      await rpc('internal_confirm_payment', {
        p_secret: internalSecret(),
        p_order_id: external,
        p_payment_id: String(order.id || dataId),
        p_status: status,
        p_amount_cents: paid,
        p_raw: order,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Mercado Pago webhook', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
