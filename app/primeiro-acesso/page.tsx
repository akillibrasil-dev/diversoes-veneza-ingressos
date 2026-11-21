'use client';

import { FormEvent, useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';

const tenantSlug=process.env.NEXT_PUBLIC_TENANT_SLUG||'diversoes-veneza';

export default function FirstAccessPage(){
  const [fullName,setFullName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [code,setCode]=useState('');
  const [status,setStatus]=useState<'loading'|'ready'|'completed'|'invalid'>('loading');
  const [tenantName,setTenantName]=useState('Diversões Veneza');
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const q=params.get('codigo'); if(q)setCode(q);
    supabase.rpc('owner_setup_status',{p_tenant_slug:tenantSlug}).then(({data,error})=>{
      if(error||!data){setStatus('invalid');return;}
      setTenantName(data.tenant_name||'Diversões Veneza');
      setStatus(data.completed?'completed':data.ready?'ready':'invalid');
    });
  },[]);

  async function submit(e:FormEvent){
    e.preventDefault(); setMessage('');
    if(password!==confirmPassword){setMessage('As senhas não conferem.');return;}
    if(password.length<8){setMessage('Use uma senha com pelo menos 8 caracteres.');return;}
    setSaving(true);
    const res=await fetch('/api/setup/owner',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tenantSlug,fullName,email,password,setupCode:code})
    });
    const out=await res.json();
    if(!res.ok){setMessage(out.error||'Não foi possível concluir a ativação.');setSaving(false);return;}
    setStatus('completed');
    setMessage(out.emailConfirmationRequired
      ?'Conta criada. Confirme o e-mail recebido e depois faça login.'
      :'Conta ativada. Você já pode entrar no painel.');
    setSaving(false);
  }

  return <main className="authWrap"><div className="authCard">
    <BrandLogo/>
    <h1>Primeiro acesso</h1>
    <p>Ativação do proprietário principal de {tenantName}.</p>
    {message&&<div className="notice" style={{marginBottom:14}}>{message}</div>}
    {status==='loading'&&<p>Verificando ativação...</p>}
    {status==='completed'&&<div className="stack"><div className="notice"><strong>Ativação concluída.</strong> O link de primeiro acesso não pode ser utilizado novamente.</div><a className="btn btnPrimary" href="/login">Ir para o login</a></div>}
    {status==='invalid'&&<div className="notice noticeError">Este ambiente não possui uma ativação de proprietário disponível.</div>}
    {status==='ready'&&<form className="stack" onSubmit={submit}>
      <div className="field"><label>Nome do proprietário</label><input className="input" required value={fullName} onChange={e=>setFullName(e.target.value)}/></div>
      <div className="field"><label>E-mail</label><input className="input" required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></div>
      <div className="field"><label>Senha</label><input className="input" required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)}/></div>
      <div className="field"><label>Confirmar senha</label><input className="input" required minLength={8} type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div>
      {!code&&<div className="field"><label>Código de ativação</label><input className="input" required value={code} onChange={e=>setCode(e.target.value)}/></div>}
      <button className="btn btnPrimary" disabled={saving}>{saving?'Ativando...':'Ativar proprietário'}</button>
      <a className="btn btnGhost" href="/login">Voltar ao login</a>
    </form>}
  </div></main>;
}
