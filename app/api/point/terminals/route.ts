import { NextRequest, NextResponse } from 'next/server';
import { ensureFreshToken, listPointTerminals } from '@/lib/mp';
import { internalSecret, rpc, verifyAccessToken } from '@/lib/server';

export async function GET(req:NextRequest){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token)return NextResponse.json({error:'Não autenticado'},{status:401});
    if(!await verifyAccessToken(token))return NextResponse.json({error:'Sessão inválida'},{status:401});
    const ctx:any=await rpc('get_my_context',{},token);
    if(!ctx)return NextResponse.json({error:'Usuário sem parque'},{status:403});
    if(ctx.demo_mode){
      return NextResponse.json({demo:true,terminals:[{id:'DEMO_POINT',label:'Point de demonstração',operating_mode:'PDV',demo:true}]});
    }
    let conn:any=await rpc('internal_connection_by_tenant',{p_secret:internalSecret(),p_tenant:ctx.tenant_id});
    if(!conn)return NextResponse.json({error:'Conta Mercado Pago ainda não conectada.'},{status:409});
    conn=await ensureFreshToken(conn);
    const raw:any=await listPointTerminals(conn.access_token);
    const source=raw?.data?.terminals||raw?.terminals||[];
    const terminals=source.map((t:any)=>({
      id:String(t.id),label:`Point ${String(t.id).split('__').pop()||t.id}`,
      operating_mode:t.operating_mode||null,pos_id:t.pos_id||null,store_id:t.store_id||null
    }));
    return NextResponse.json({demo:false,terminals});
  }catch(e:any){return NextResponse.json({error:e?.message||'Falha ao listar maquinetas.'},{status:500})}
}
