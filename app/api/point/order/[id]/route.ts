import { NextRequest, NextResponse } from 'next/server';
import { ensureFreshToken, getPointOrder } from '@/lib/mp';
import { internalSecret, rpc, verifyAccessToken } from '@/lib/server';

function paymentInfo(order:any){
  const p=order?.transactions?.payments?.[0]||{};
  return {
    paidCents:Math.round(Number(order?.total_paid_amount||p?.paid_amount||p?.amount||0)*100),
    reference:String(p?.reference?.id||p?.reference_id||p?.id||''),
    method:String(p?.payment_method?.type||p?.payment_method?.id||'')
  };
}

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token||!await verifyAccessToken(token))return NextResponse.json({error:'Sessão inválida'},{status:401});
    const ctx:any=await rpc('get_my_context',{},token); if(!ctx)return NextResponse.json({error:'Sem acesso'},{status:403});
    const {id}=await params; const key=req.nextUrl.searchParams.get('k')||'';
    let local:any=await rpc('get_pos_order',{p_order_id:id,p_access_key:key},token);
    if(!local)return NextResponse.json({error:'Venda não encontrada.'},{status:404});

    if(local.order.status==='pending_payment' && local.order.provider_order_id && !ctx.demo_mode){
      let conn:any=await rpc('internal_connection_by_tenant',{p_secret:internalSecret(),p_tenant:ctx.tenant_id});
      if(conn){
        conn=await ensureFreshToken(conn);
        const mp:any=await getPointOrder(local.order.provider_order_id,conn.access_token);
        const info=paymentInfo(mp);
        await rpc('internal_confirm_point_order',{
          p_secret:internalSecret(),p_external_reference:String(mp.external_reference||id),
          p_provider_order_id:String(mp.id||local.order.provider_order_id),p_status:String(mp.status||'unknown'),
          p_status_detail:String(mp.status_detail||''),p_paid_amount_cents:info.paidCents,
          p_payment_reference:info.reference,p_payment_method:info.method,p_raw:mp
        });
        local=await rpc('get_pos_order',{p_order_id:id,p_access_key:key},token);
      }
    }
    return NextResponse.json(local);
  }catch(e:any){return NextResponse.json({error:e?.message||'Falha ao consultar a venda.'},{status:500})}
}
