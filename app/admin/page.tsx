'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';
import { Activity, LogOut, Plus, Power, RefreshCw, Users, WalletCards } from 'lucide-react';

type Ctx={user_id:string;tenant_id:string;role:'owner'|'admin'|'cashier'|'staff';tenant_name:string;tenant_slug:string;demo_mode:boolean;full_name?:string;email?:string};
type Product={id:string;name:string;description:string|null;price_cents:number;tickets_per_unit:number;active:boolean;sort_order:number};
type Attraction={id:string;name:string;description:string|null;active:boolean};
type Order={id:string;status:string;total_cents:number;buyer_name:string|null;provider:string|null;print_status:string;created_at:string;operator?:{full_name?:string|null;email?:string|null}|null};
type Metric={sales_today:number;revenue_today_cents:number;tickets_today:number;printed_today:number};
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);

export default function AdminPage(){
  const router=useRouter();
  const [ctx,setCtx]=useState<Ctx|null>(null); const [loading,setLoading]=useState(true); const [message,setMessage]=useState('');
  const [metrics,setMetrics]=useState<Metric>({sales_today:0,revenue_today_cents:0,tickets_today:0,printed_today:0});
  const [products,setProducts]=useState<Product[]>([]); const [attractions,setAttractions]=useState<Attraction[]>([]); const [orders,setOrders]=useState<Order[]>([]);
  const [mp,setMp]=useState<any>({status:'disconnected'});
  const [pName,setPName]=useState(''); const [pPrice,setPPrice]=useState(''); const [pTickets,setPTickets]=useState('1');
  const [aName,setAName]=useState('');

  const load=useCallback(async()=>{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){router.replace('/login');return;}
    const {data:c,error}=await supabase.rpc('get_my_context');
    if(error||!c||!['owner','admin'].includes(c.role)){
      router.replace(c?.role==='cashier'?'/pdv':c?.role==='staff'?'/portaria':'/login');return;
    }
    setCtx(c as Ctx);
    const tid=c.tenant_id;
    const connPromise=c.role==='owner'
      ? supabase.rpc('get_payment_connection_admin',{p_tenant:tid})
      : Promise.resolve({data:{status:'restricted'},error:null} as any);
    const [m,p,a,o,conn]=await Promise.all([
      supabase.rpc('admin_dashboard',{p_tenant:tid}),
      supabase.from('products').select('*').eq('tenant_id',tid).order('sort_order'),
      supabase.from('attractions').select('*').eq('tenant_id',tid).order('name'),
      supabase.from('orders').select('id,status,total_cents,buyer_name,provider,print_status,created_at,operator:profiles!orders_operator_id_fkey(full_name,email)').eq('tenant_id',tid).order('created_at',{ascending:false}).limit(20),
      connPromise,
    ]);
    if(m.data)setMetrics(m.data as Metric); if(p.data)setProducts(p.data as Product[]); if(a.data)setAttractions(a.data as Attraction[]); if(o.data)setOrders(o.data as Order[]); if(conn.data)setMp(conn.data);
    setLoading(false);
  },[router]);
  useEffect(()=>{load()},[load]);

  async function logout(){await supabase.auth.signOut();router.replace('/login')}
  async function addProduct(e:FormEvent){e.preventDefault();if(!ctx)return;setMessage('');const cents=Math.round(Number(pPrice.replace(',','.'))*100);if(!pName||!cents)return;const {error}=await supabase.from('products').insert({tenant_id:ctx.tenant_id,name:pName,price_cents:cents,tickets_per_unit:Number(pTickets)||1,active:true,sort_order:products.length+1});setMessage(error?error.message:'Produto criado.');if(!error){setPName('');setPPrice('');setPTickets('1');load()}}
  async function editProduct(p:Product){
    const name=window.prompt('Nome do produto',p.name); if(!name)return;
    const price=window.prompt('Preço em reais',String(p.price_cents/100).replace('.',',')); if(!price)return;
    const tickets=window.prompt('Quantos ingressos este produto gera?',String(p.tickets_per_unit)); if(!tickets)return;
    const cents=Math.round(Number(price.replace(',','.'))*100); if(!cents)return alert('Preço inválido');
    const {error}=await supabase.from('products').update({name,price_cents:cents,tickets_per_unit:Number(tickets)||1}).eq('id',p.id);
    setMessage(error?error.message:'Produto atualizado.');load();
  }
  async function toggleProduct(p:Product){await supabase.from('products').update({active:!p.active}).eq('id',p.id);load()}
  async function addAttraction(e:FormEvent){e.preventDefault();if(!ctx||!aName)return;const {error}=await supabase.from('attractions').insert({tenant_id:ctx.tenant_id,name:aName,active:true});setMessage(error?error.message:'Atração criada.');if(!error){setAName('');load()}}
  async function toggleAttraction(a:Attraction){await supabase.from('attractions').update({active:!a.active}).eq('id',a.id);load()}
  async function connectMp(){
    const {data:{session}}=await supabase.auth.getSession();if(!session)return;
    const res=await fetch('/api/mercadopago/authorize',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});const out=await res.json();
    if(!res.ok){setMessage(out.error||'Integração Mercado Pago ainda não configurada.');return;} window.location.href=out.url;
  }
  async function disconnectMp(){if(!ctx||ctx.role!=='owner')return;if(!confirm('Desconectar a conta Mercado Pago?'))return;const {error}=await supabase.rpc('owner_disconnect_mp',{p_tenant:ctx.tenant_id});setMessage(error?error.message:'Mercado Pago desconectado.');load()}

  if(loading)return <main className="authWrap"><div className="authCard"><BrandLogo/><p>Carregando painel...</p></div></main>;
  return <div className="adminLayout">
    <header className="adminTop"><div className="headerInner"><BrandLogo compact/><div className="row"><a className="btn btnGhost btnSmall" href="/admin/usuarios"><Users size={15}/> Usuários</a><a className="btn btnGhost btnSmall" href="/admin/suporte"><Activity size={15}/> Suporte</a><a className="btn btnGhost btnSmall" href="/pdv">Abrir PDV</a><button className="btn btnGhost btnSmall" onClick={logout}><LogOut size={15}/> Sair</button></div></div></header>
    <main className="container adminMain">
      <div className="adminHero"><div><h1>Painel do parque</h1><p>{ctx?.full_name||'Administrador'} · {ctx?.tenant_name} · {ctx?.role==='owner'?'Proprietário':'Administrador'}</p></div><button className="btn btnGhost" onClick={load}><RefreshCw size={16}/> Atualizar</button></div>
      {message&&<div className="notice" style={{marginBottom:18}}>{message}</div>}
      {ctx?.demo_mode&&<div className="notice noticeWarn" style={{marginBottom:18}}><strong>Modo demonstração ativo.</strong> As compras podem ser simuladas sem cobrança. Ao conectar o Mercado Pago, novas vendas do PDV passam ao fluxo real na maquineta Point.</div>}
      <section className="metrics"><div className="metric"><small>Vendas hoje</small><strong>{metrics.sales_today}</strong></div><div className="metric"><small>Receita hoje</small><strong>{money(metrics.revenue_today_cents)}</strong></div><div className="metric"><small>Ingressos emitidos</small><strong>{metrics.tickets_today}</strong></div><div className="metric"><small>Tickets impressos</small><strong>{metrics.printed_today}</strong></div></section>
      <div className="adminGrid">
        <section className="adminCard full"><div className="row space"><h2>Produtos e preços</h2><span className="muted small">Proprietário e administradores podem alterar</span></div><div className="tableWrap"><table><thead><tr><th>Produto</th><th>Preço</th><th>Tickets</th><th>Status</th><th></th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{money(p.price_cents)}</td><td>{p.tickets_per_unit}</td><td>{p.active?'Ativo':'Inativo'}</td><td><div className="inlineActions"><button className="btn btnGhost btnSmall" onClick={()=>editProduct(p)}>Editar</button><button className="btn btnGhost btnSmall" onClick={()=>toggleProduct(p)}><Power size={14}/>{p.active?'Desativar':'Ativar'}</button></div></td></tr>)}</tbody></table></div>
          <form className="inlineForm" onSubmit={addProduct}><input className="input" placeholder="Novo produto" value={pName} onChange={e=>setPName(e.target.value)}/><input className="input" placeholder="Preço (R$)" value={pPrice} onChange={e=>setPPrice(e.target.value)}/><input className="input" type="number" min="1" placeholder="Tickets" value={pTickets} onChange={e=>setPTickets(e.target.value)}/><button className="btn btnPrimary"><Plus size={16}/> Criar</button></form>
        </section>

        <section className="adminCard"><h2>Equipe e acessos</h2><p className="muted small">Cadastre administradores auxiliares e operadores do PDV sem acessar o Supabase.</p><a className="btn btnDark" href="/admin/usuarios"><Users size={17}/> Gerenciar usuários</a></section>

        <section className="adminCard"><h2>Mercado Pago Point</h2>
          {ctx?.role==='owner'?<>
            <div className="notice" style={{marginBottom:14}}>A conexão financeira é exclusiva do proprietário principal. A plataforma nunca recebe a senha do Mercado Pago.</div>
            {mp?.status==='connected'?<><p><strong>Conta conectada</strong><br/><span className="muted small">{mp.provider_nickname||mp.provider_email||mp.provider_user_id}</span></p><button className="btn btnDanger" onClick={disconnectMp}>Desconectar</button></>:<button className="btn btnPrimary" onClick={connectMp}><WalletCards size={18}/> Conectar Mercado Pago</button>}
          </>:<div className="notice">Somente o proprietário principal pode conectar ou desconectar a conta Mercado Pago.</div>}
        </section>

        <section className="adminCard full"><div className="row space"><h2>Vendas recentes</h2><span className="muted small">Operador, pagamento e impressão rastreados por venda</span></div><div className="tableWrap"><table><thead><tr><th>Pedido</th><th>Operador</th><th>Total</th><th>Status</th><th>Impressão</th><th>Data</th><th></th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{o.id.slice(0,8).toUpperCase()}</td><td>{o.operator?.full_name||o.operator?.email||'Online / sistema'}</td><td>{money(o.total_cents)}</td><td>{o.status}</td><td>{o.print_status}</td><td>{new Date(o.created_at).toLocaleString('pt-BR')}</td><td><a className="btn btnGhost btnSmall" href={`/admin/vendas/${o.id}`}>Detalhes</a></td></tr>)}</tbody></table></div></section>
      </div>
    </main>
  </div>;
}
