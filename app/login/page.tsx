'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';

export default function LoginPage(){
  const router=useRouter();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault(); setLoading(true); setError('');
    const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error){ setError('E-mail ou senha inválidos.'); setLoading(false); return; }
    const {data, error:ctxErr}=await supabase.rpc('get_my_context');
    if(ctxErr || !data){ setError('Usuário sem acesso ao parque.'); await supabase.auth.signOut(); setLoading(false); return; }
    router.replace(['owner','admin'].includes(data.role)?'/admin':data.role==='cashier'?'/pdv':'/portaria');
  }
  return <main className="authWrap"><form className="authCard" onSubmit={submit}>
    <BrandLogo />
    <h1>Acesso da equipe</h1><p>Entre como proprietário, administrador ou operador do PDV.</p>
    <div className="stack">
      {error&&<div className="notice noticeError">{error}</div>}
      <div className="field"><label>E-mail</label><input className="input" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></div>
      <div className="field"><label>Senha</label><input className="input" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></div>
      <button className="btn btnPrimary" disabled={loading}>{loading?'Entrando...':'Entrar'}</button>
      <a className="btn btnGhost" href="/primeiro-acesso">Primeiro acesso do proprietário</a>
      <a className="btn btnGhost" href="/">Voltar para o PDV</a>
    </div>
  </form></main>;
}
