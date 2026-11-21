import { NextRequest, NextResponse } from 'next/server';
import { ensureFreshToken, setupPointTerminal } from '@/lib/mp';
import { internalSecret, rpc, verifyAccessToken } from '@/lib/server';

export async function POST(req:NextRequest){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token||!await verifyAccessToken(token))return NextResponse.json({error:'Sessão inválida'},{status:401});
    const ctx:any=await rpc('get_my_context',{},token);
    if(!ctx||ctx.role!=='owner')return NextResponse.json({error:'Apenas o administrador pode configurar a maquineta.'},{status:403});
    const {terminalId}=await req.json();
    if(!terminalId)return NextResponse.json({error:'Terminal não informado.'},{status:400});
    if(ctx.demo_mode)return NextResponse.json({ok:true,demo:true});
    let conn:any=await rpc('internal_connection_by_tenant',{p_secret:internalSecret(),p_tenant:ctx.tenant_id});
    if(!conn)return NextResponse.json({error:'Mercado Pago não conectado.'},{status:409});
    conn=await ensureFreshToken(conn);
    const data=await setupPointTerminal(conn.access_token,String(terminalId));
    await rpc('set_selected_terminal',{p_tenant:ctx.tenant_id,p_terminal_id:String(terminalId),p_terminal_label:String(terminalId)},token);
    return NextResponse.json({ok:true,data});
  }catch(e:any){return NextResponse.json({error:e?.message||'Falha ao configurar o terminal.'},{status:400})}
}
