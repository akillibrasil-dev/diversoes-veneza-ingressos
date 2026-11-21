import { NextRequest, NextResponse } from 'next/server';
import { internalSecret, rpc, signupUser, verifyAccessToken } from '@/lib/server';

type Role='owner'|'admin'|'cashier'|'staff';

export async function POST(req:NextRequest){
  try{
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    const user=token?await verifyAccessToken(token):null;
    if(!user)return NextResponse.json({error:'Não autenticado'},{status:401});

    const ctx:any=await rpc('get_my_context',{},token);
    if(!ctx||!['owner','admin'].includes(ctx.role))return NextResponse.json({error:'Sem permissão'},{status:403});

    const {fullName,email,password,tenantId,role}=await req.json();
    if(tenantId!==ctx.tenant_id)return NextResponse.json({error:'Tenant inválido'},{status:403});
    if(!fullName||!email||!password||String(password).length<8)return NextResponse.json({error:'Informe nome, e-mail e senha com ao menos 8 caracteres.'},{status:400});

    const requestedRole=String(role||'cashier') as Role;
    if(!['admin','cashier','staff'].includes(requestedRole))return NextResponse.json({error:'Perfil inválido.'},{status:400});
    if(ctx.role==='admin'&&requestedRole!=='cashier'&&requestedRole!=='staff')return NextResponse.json({error:'Administradores auxiliares só podem criar operadores.'},{status:403});

    const normalizedEmail=String(email).toLowerCase().trim();
    const created=await signupUser(normalizedEmail,String(password),String(fullName).trim());
    if(!created.user?.id)return NextResponse.json({error:'Não foi possível criar o usuário. O e-mail pode já estar cadastrado.'},{status:400});

    await rpc('internal_add_member',{
      p_secret:internalSecret(),
      p_user_id:created.user.id,
      p_tenant:tenantId,
      p_role:requestedRole,
      p_full_name:String(fullName).trim(),
      p_email:normalizedEmail,
    });

    return NextResponse.json({ok:true,userId:created.user.id,role:requestedRole});
  }catch(e:any){
    const msg=String(e?.message||'Falha ao criar usuário.');
    return NextResponse.json({error:msg.includes('already registered')?'Este e-mail já está cadastrado.':msg},{status:400});
  }
}
