import { NextRequest, NextResponse } from 'next/server';
import { rpc, verifyAccessToken } from '@/lib/server';
import { signState } from '@/lib/signing';

export async function POST(req:NextRequest){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token)return NextResponse.json({error:'Não autenticado'},{status:401});
    const user=await verifyAccessToken(token); if(!user)return NextResponse.json({error:'Sessão inválida'},{status:401});
    const ctx:any=await rpc('get_my_context',{},token);
    if(!ctx||ctx.role!=='owner')return NextResponse.json({error:'Apenas o dono pode conectar o Mercado Pago.'},{status:403});
    const clientId=process.env.MP_CLIENT_ID; const site=process.env.SITE_URL;
    if(!clientId||!process.env.MP_CLIENT_SECRET||!site){
      return NextResponse.json({error:'A aplicação Mercado Pago ainda não foi configurada. Falta cadastrar MP_CLIENT_ID/MP_CLIENT_SECRET.'},{status:409});
    }
    const state=signState({tenantId:ctx.tenant_id,userId:user.id,nonce:crypto.randomUUID(),exp:Date.now()+10*60*1000});
    const url=new URL('https://auth.mercadopago.com/authorization');
    url.searchParams.set('client_id',clientId); url.searchParams.set('response_type','code'); url.searchParams.set('platform_id','mp');
    url.searchParams.set('state',state); url.searchParams.set('redirect_uri',`${site}/api/mercadopago/callback`);
    return NextResponse.json({url:url.toString()});
  }catch(e:any){return NextResponse.json({error:e?.message||'Falha ao iniciar conexão.'},{status:500})}
}
