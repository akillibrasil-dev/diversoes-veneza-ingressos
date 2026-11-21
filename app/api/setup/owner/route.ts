import { NextRequest, NextResponse } from 'next/server';
import { internalSecret, rpc, signupUser } from '@/lib/server';

export async function POST(req:NextRequest){
  try{
    const {tenantSlug,fullName,email,password,setupCode}=await req.json();
    if(!tenantSlug||!fullName||!email||!setupCode||!password||String(password).length<8){
      return NextResponse.json({error:'Dados de ativação incompletos.'},{status:400});
    }

    const valid=await rpc<boolean>('internal_validate_owner_setup',{
      p_secret:internalSecret(),
      p_tenant_slug:String(tenantSlug),
      p_setup_code:String(setupCode)
    });
    if(!valid)return NextResponse.json({error:'Código de ativação inválido ou já utilizado.'},{status:403});

    const normalizedEmail=String(email).toLowerCase().trim();
    const created=await signupUser(normalizedEmail,String(password),String(fullName).trim());
    if(!created.user?.id)return NextResponse.json({error:'Não foi possível criar a conta do proprietário.'},{status:400});

    await rpc('internal_claim_primary_owner',{
      p_secret:internalSecret(),
      p_tenant_slug:String(tenantSlug),
      p_setup_code:String(setupCode),
      p_user_id:created.user.id,
      p_full_name:String(fullName).trim(),
      p_email:normalizedEmail
    });

    return NextResponse.json({
      ok:true,
      emailConfirmationRequired:!created.access_token
    });
  }catch(e:any){
    const msg=String(e?.message||'Falha na ativação.');
    return NextResponse.json({error:msg.includes('already registered')?'Este e-mail já possui uma conta. Use outro endereço ou faça login.':msg},{status:400});
  }
}
