import { NextRequest, NextResponse } from 'next/server';
import { createMpOrder, ensureFreshToken } from '@/lib/mp';
import { internalSecret, rpc } from '@/lib/server';

export async function POST(req: NextRequest){
  try{
    if(!process.env.MP_CLIENT_ID || !process.env.MP_CLIENT_SECRET){
      return NextResponse.json({error:'Mercado Pago ainda não configurado. Use o modo demonstração.'},{status:409});
    }
    const {orderId,accessKey}=await req.json();
    if(!orderId||!accessKey)return NextResponse.json({error:'Pedido inválido'},{status:400});
    let ctx:any=await rpc('internal_checkout_context',{p_secret:internalSecret(),p_order_id:orderId,p_access_key:accessKey});
    ctx=await ensureFreshToken(ctx);
    const site=process.env.SITE_URL || req.nextUrl.origin;
    const returnUrl=`${site}/pedido/${encodeURIComponent(orderId)}?k=${encodeURIComponent(accessKey)}`;
    const mpOrder=await createMpOrder(ctx,returnUrl);
    await rpc('internal_set_checkout_id',{p_secret:internalSecret(),p_order_id:orderId,p_checkout_id:mpOrder.id});
    return NextResponse.json({checkoutUrl:mpOrder.checkout_url,checkoutId:mpOrder.id});
  }catch(e:any){
    const msg=String(e?.message||e);
    const friendly=msg.includes('mp_not_connected')?'A conta Mercado Pago do parque ainda não está conectada.':msg;
    return NextResponse.json({error:friendly},{status:400});
  }
}
