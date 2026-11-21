import { NextRequest, NextResponse } from 'next/server';
import { internalSecret, rpc, signupUser, verifyAccessToken } from '@/lib/server';

export async function POST(req:NextRequest){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    const user=token?await verifyAccessToken(token):null;
    if(!user)return NextResponse.json({error:'Não autenticado'},{status:401});
    const ctx:any=await rpc('get_my_context',{},token);
    if(!ctx||ctx.role!=='owner')return NextResponse.json({error:'Sem permissão'},{status:403});
    const {fullName,email,password,tenantId,role}=await req.json();
    if(tenantId!==ctx.tenant_id)return NextResponse.json({error:'Tenant inválido'},{status:403});
    if(!email||!password||String(password).length<8)return NextResponse.json({error:'Informe e-mail e senha com ao menos 8 caracteres.'},{status:400});
    const normalizedRole=role==='staff'?'staff':'cashier';
    const created=await signupUser(String(email).toLowerCase().trim(),String(password),String(fullName||'Operador'));
    if(!created.user?.id)return NextResponse.json({error:'Não foi possível criar o usuário. O e-mail pode já estar cadastrado.'},{status:400});
    await rpc('internal_add_member',{
      p_secret:internalSecret(),p_user_id:created.user.id,p_tenant:tenantId,p_role:normalizedRole,
      p_full_name:String(fullName||'Operador'),p_email:String(email).toLowerCase().trim(),
    });
    return NextResponse.json({ok:true,userId:created.user.id,role:normalizedRole});
  }catch(e:any){return NextResponse.json({error:e?.message||'Falha ao criar operador.'},{status:400})}
}
