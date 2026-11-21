import { NextRequest, NextResponse } from 'next/server';
import { exchangeAuthorizationCode, mpGet } from '@/lib/mp';
import { internalSecret, rpc } from '@/lib/server';
import { verifyState } from '@/lib/signing';

type State={tenantId:string;userId:string;exp:number};
export async function GET(req:NextRequest){
  const site=process.env.SITE_URL||req.nextUrl.origin;
  try{
    const code=req.nextUrl.searchParams.get('code'); const stateRaw=req.nextUrl.searchParams.get('state')||'';
    const state=verifyState<State>(stateRaw);
    if(!code||!state) return NextResponse.redirect(`${site}/admin?mp=erro_estado`);
    const tok=await exchangeAuthorizationCode(code);
    let me:any={}; try{me=await mpGet('/users/me',tok.access_token)}catch{}
    const expiresAt=tok.expires_in?new Date(Date.now()+Number(tok.expires_in)*1000).toISOString():null;
    await rpc('internal_save_mp_connection',{
      p_secret:internalSecret(),p_tenant:state.tenantId,p_provider_user_id:String(tok.user_id),
      p_nickname:me.nickname||null,p_email:me.email||null,p_access_token:tok.access_token,
      p_refresh_token:tok.refresh_token||null,p_public_key:tok.public_key||null,p_expires_at:expiresAt,
    });
    await rpc('internal_set_demo_mode',{p_secret:internalSecret(),p_tenant:state.tenantId,p_demo:false});
    return NextResponse.redirect(`${site}/admin?mp=conectado`);
  }catch(e){console.error(e);return NextResponse.redirect(`${site}/admin?mp=erro`)}
}
