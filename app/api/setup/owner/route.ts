import { NextRequest, NextResponse } from 'next/server';
import { internalSecret, rpc, signInUser, signupUser } from '@/lib/server';

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
    const normalizedName=String(fullName).trim();

    // Se o e-mail já existir neste Supabase, a senha informada precisa autenticar a conta.
    // Isso evita sobrescrever credenciais usadas por outros produtos que compartilham o projeto.
    const existing=await signInUser(normalizedEmail,String(password));
    let userId=existing.user?.id||null;
    let emailConfirmationRequired=false;

    if(!userId){
      const created=await signupUser(normalizedEmail,String(password),normalizedName);

      // O GoTrue pode devolver um usuário sem identities quando o e-mail já existe.
      if(!created.user?.id || created.identities.length===0){
        return NextResponse.json({
          error:'Este e-mail já possui uma conta. Use a senha já cadastrada ou redefina a senha antes de ativar o proprietário.'
        },{status:409});
      }

      userId=created.user.id;
      emailConfirmationRequired=!created.access_token;
    }

    await rpc('internal_claim_primary_owner',{
      p_secret:internalSecret(),
      p_tenant_slug:String(tenantSlug),
      p_setup_code:String(setupCode),
      p_user_id:userId,
      p_full_name:normalizedName,
      p_email:normalizedEmail
    });

    return NextResponse.json({ok:true,emailConfirmationRequired});
  }catch(e:any){
    const msg=String(e?.message||'Falha na ativação.');
    const normalized=
      /already registered|already been registered|user already registered/i.test(msg)
        ?'Este e-mail já possui uma conta. Use a senha já cadastrada ou redefina a senha.'
        :msg;
    return NextResponse.json({error:normalized},{status:400});
  }
}
