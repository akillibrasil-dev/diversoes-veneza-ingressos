import { NextRequest, NextResponse } from 'next/server';
import { createPointOrder, ensureFreshToken } from '@/lib/mp';
import { internalSecret, rpc, verifyAccessToken } from '@/lib/server';

export async function POST(req:NextRequest){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token||!await verifyAccessToken(token))return NextResponse.json({error:'Sessão inválida'},{status:401});
    const ctx:any=await rpc('get_my_context',{},token);
    if(!ctx||ctx.role==='staff')return NextResponse.json({error:'Perfil sem permissão para vender.'},{status:403});
    const {orderId,accessKey,terminalId}=await req.json();
    if(!orderId||!accessKey||!terminalId)return NextResponse.json({error:'Dados da venda incompletos.'},{status:400});

    if(ctx.demo_mode){
      const result:any=await rpc('demo_approve_pos_order',{p_order_id:orderId,p_access_key:accessKey},token);
      return NextResponse.json({demo:true,status:result.status,printJobs:result.print_jobs});
    }

    let pointCtx:any=await rpc('internal_point_checkout_context',{
      p_secret:internalSecret(),p_order_id:orderId,p_access_key:accessKey
    });
    pointCtx=await ensureFreshToken(pointCtx);
    const mp:any=await createPointOrder(pointCtx,String(terminalId));
    await rpc('internal_mark_point_created',{
      p_secret:internalSecret(),p_order_id:orderId,p_provider_order_id:String(mp.id),
      p_terminal_id:String(terminalId),p_raw:mp
    });
    return NextResponse.json({demo:false,status:mp.status,providerOrderId:mp.id});
  }catch(e:any){
    const msg=String(e?.message||e);
    const friendly=msg.includes('already_queued_order_for_terminal')?'A maquineta já possui uma cobrança pendente. Conclua ou cancele antes de tentar novamente.':msg.includes('mp_not_connected')?'Mercado Pago ainda não conectado.':msg;
    return NextResponse.json({error:friendly},{status:400});
  }
}
