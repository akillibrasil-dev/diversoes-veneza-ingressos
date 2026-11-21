'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';

type Role='owner'|'admin'|'cashier'|'staff';
type Ctx={user_id:string;tenant_id:string;role:Role;tenant_name:string;full_name?:string};
type Member={user_id:string;full_name:string|null;email:string|null;role:Role;active:boolean;is_primary_owner:boolean;created_at:string};

const roleLabel:Record<Role,string>={
  owner:'Proprietário principal',
  admin:'Administrador',
  cashier:'Operador do PDV',
  staff:'Equipe'
};

export default function UsersPage(){
  const router=useRouter();
  const [ctx,setCtx]=useState<Ctx|null>(null);
  const [users,setUsers]=useState<Member[]>([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [fullName,setFullName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [role,setRole]=useState<'admin'|'cashier'>('cashier');
  const [saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){router.replace('/login');return;}
    const {data:c,error}=await supabase.rpc('get_my_context');
    if(error||!c||!['owner','admin'].includes(c.role)){router.replace('/login');return;}
    setCtx(c as Ctx);
    if(c.role==='admin')setRole('cashier');
    const {data,error:listError}=await supabase.rpc('admin_list_users',{p_tenant:c.tenant_id});
    if(listError)setMessage(listError.message); else setUsers((data||[]) as Member[]);
    setLoading(false);
  },[router]);

  useEffect(()=>{load()},[load]);

  async function createUser(e:FormEvent){
    e.preventDefault(); if(!ctx)return;
    setSaving(true); setMessage('');
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){setSaving(false);return;}
    const requestedRole=ctx.role==='owner'?role:'cashier';
    const res=await fetch('/api/admin/users',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({tenantId:ctx.tenant_id,fullName,email,password,role:requestedRole})
    });
    const out=await res.json();
    if(!res.ok)setMessage(out.error||'Não foi possível criar o usuário.');
    else{
      setMessage(requestedRole==='admin'?'Administrador criado.':'Operador criado.');
      setFullName('');setEmail('');setPassword('');setRole('cashier');
      await load();
    }
    setSaving(false);
  }

  async function toggleActive(user:Member){
    if(!ctx||user.is_primary_owner)return;
    const action=user.active?'desativar':'reativar';
    if(!confirm(`Deseja ${action} ${user.full_name||user.email}?`))return;
    const {error}=await supabase.rpc('admin_set_member_active',{
      p_tenant:ctx.tenant_id,p_user_id:user.user_id,p_active:!user.active
    });
    setMessage(error?error.message:`Usuário ${user.active?'desativado':'reativado'}.`);
    if(!error)load();
  }

  async function changeRole(user:Member){
    if(!ctx||ctx.role!=='owner'||user.is_primary_owner)return;
    const next=window.prompt('Informe o novo perfil: admin ou cashier',user.role==='admin'?'admin':'cashier');
    if(!next||!['admin','cashier'].includes(next))return alert('Use admin ou cashier.');
    const {error}=await supabase.rpc('owner_set_member_role',{
      p_tenant:ctx.tenant_id,p_user_id:user.user_id,p_role:next
    });
    setMessage(error?error.message:'Perfil atualizado.');
    if(!error)load();
  }

  if(loading)return <main className="authWrap"><div className="authCard"><BrandLogo/><p>Carregando usuários...</p></div></main>;

  return <div className="adminLayout">
    <header className="adminTop"><div className="headerInner"><BrandLogo compact/><div className="row"><a className="btn btnGhost btnSmall" href="/admin"><ArrowLeft size={15}/> Painel</a><button className="btn btnGhost btnSmall" onClick={load}><RefreshCw size={15}/> Atualizar</button></div></div></header>
    <main className="container adminMain">
      <div className="adminHero"><div><h1>Usuários e acessos</h1><p>{ctx?.tenant_name} · {ctx?.role==='owner'?'Proprietário principal':'Administrador'}</p></div></div>
      {message&&<div className="notice" style={{marginBottom:18}}>{message}</div>}

      <div className="adminGrid">
        <section className="adminCard">
          <h2><UserPlus size={19}/> Novo usuário</h2>
          <p className="muted small">{ctx?.role==='owner'?'O proprietário pode criar administradores auxiliares e operadores.':'Administradores auxiliares podem criar operadores do PDV.'}</p>
          <form className="stack" onSubmit={createUser}>
            <input className="input" required placeholder="Nome completo" value={fullName} onChange={e=>setFullName(e.target.value)}/>
            <input className="input" required type="email" placeholder="E-mail" value={email} onChange={e=>setEmail(e.target.value)}/>
            <input className="input" required type="password" minLength={8} placeholder="Senha inicial (mín. 8 caracteres)" value={password} onChange={e=>setPassword(e.target.value)}/>
            {ctx?.role==='owner'&&<div className="field"><label>Perfil</label><select className="input" value={role} onChange={e=>setRole(e.target.value as 'admin'|'cashier')}><option value="cashier">Operador do PDV</option><option value="admin">Administrador auxiliar</option></select></div>}
            <button className="btn btnPrimary" disabled={saving}><UserPlus size={16}/>{saving?'Criando...':'Criar usuário'}</button>
          </form>
        </section>

        <section className="adminCard">
          <h2><ShieldCheck size={19}/> Regra de governança</h2>
          <div className="notice">
            Existe apenas um proprietário principal. Ele controla a conexão Mercado Pago e pode criar administradores. Administradores auxiliares gerenciam a operação, mas não podem assumir a propriedade nem alterar a conexão financeira.
          </div>
        </section>

        <section className="adminCard full">
          <div className="row space"><h2><Users size={19}/> Equipe cadastrada</h2><span className="muted small">{users.length} usuário(s)</span></div>
          <div className="tableWrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead><tbody>
            {users.map(user=><tr key={user.user_id}>
              <td><strong>{user.full_name||'Sem nome'}</strong>{user.is_primary_owner&&<div className="muted small">Proprietário principal</div>}</td>
              <td>{user.email||'—'}</td>
              <td>{roleLabel[user.role]||user.role}</td>
              <td>{user.active?'Ativo':'Desativado'}</td>
              <td><div className="inlineActions">
                {ctx?.role==='owner'&&!user.is_primary_owner&&<button className="btn btnGhost btnSmall" onClick={()=>changeRole(user)}>Alterar perfil</button>}
                {!user.is_primary_owner&&!(ctx?.role==='admin'&&['owner','admin'].includes(user.role))&&<button className={`btn btnSmall ${user.active?'btnDanger':'btnGhost'}`} onClick={()=>toggleActive(user)}>{user.active?'Desativar':'Reativar'}</button>}
              </div></td>
            </tr>)}
          </tbody></table></div>
        </section>
      </div>
    </main>
  </div>;
}
