'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, LogOut, Printer, RefreshCw, ShoppingCart, Wifi, WifiOff } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';

type Ctx={user_id:string;tenant_id:string;role:'owner'|'cashier'|'staff';tenant_name:string;tenant_slug:string;demo_mode:boolean;full_name?:string;email?:string};
type Product={id:string;name:string;description:string|null;price_cents:number;tickets_per_unit:number;sort_order:number};
type Cart=Record<string,number>;
type Terminal={id:string;label?:string;operating_mode?:string;pos_id?:string|null;store_id?:string|null;demo?:boolean};
type PosOrder={order:{id:string;status:string;total_cents:number;is_demo:boolean;provider?:string|null;provider_order_id?:string|null;terminal_id?:string|null;payment_method?:string|null;print_status:string;last_error?:string|null};print_jobs:Array<any>};

const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export default function PdvPage(){
  const router=useRouter();
  const [ctx,setCtx]=useState<Ctx|null>(null);
  const [products,setProducts]=useState<Product[]>([]);
  const [cart,setCart]=useState<Cart>({});
  const [terminals,setTerminals]=useState<Terminal[]>([]);
  const [terminalId,setTerminalId]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [phase,setPhase]=useState<'idle'|'sending'|'waiting'|'paid'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [online,setOnline]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true); setMessage('');
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){router.replace('/login');return;}
    const {data:c,error:cErr}=await supabase.rpc('get_my_context');
    if(cErr||!c){router.replace('/login');return;}
    if(c.role==='staff'){router.replace('/portaria');return;}
    setCtx(c as Ctx);

    const {data:p,error:pErr}=await supabase.from('products')
      .select('id,name,description,price_cents,tickets_per_unit,sort_order')
      .eq('tenant_id',c.tenant_id).eq('active',true).order('sort_order');
    if(pErr)setMessage('Não foi possível carregar o catálogo.');
    else setProducts((p||[]) as Product[]);

    const {data:pref}=await supabase.rpc('get_selected_terminal',{p_tenant:c.tenant_id});
    try{
      const res=await fetch('/api/point/terminals',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});
      const body=await res.json();
      if(!res.ok)throw new Error(body.error||'Falha ao listar maquinetas');
      const list=(body.terminals||[]) as Terminal[];
      setTerminals(list);
      const preferred=pref?.terminal_id && list.some(t=>t.id===pref.terminal_id)?pref.terminal_id:list[0]?.id||'';
      setTerminalId(preferred);
    }catch(e:any){
      setTerminals([]); setTerminalId('');
      setMessage(e?.message||'Não foi possível carregar a maquineta.');
    }
    setLoading(false);
  },[router]);

  useEffect(()=>{load()},[load]);
  useEffect(()=>{
    const sync=()=>setOnline(navigator.onLine);
    sync(); window.addEventListener('online',sync);window.addEventListener('offline',sync);
    return()=>{window.removeEventListener('online',sync);window.removeEventListener('offline',sync)};
  },[]);

  const lines=useMemo(()=>products.filter(p=>(cart[p.id]||0)>0).map(p=>({...p,quantity:cart[p.id]})),[products,cart]);
  const total=lines.reduce((s,l)=>s+l.price_cents*l.quantity,0);
  const ticketCount=lines.reduce((s,l)=>s+l.tickets_per_unit*l.quantity,0);

  function qty(id:string,d:number){setCart(c=>({...c,[id]:Math.max(0,(c[id]||0)+d)}))}
  async function logout(){await supabase.auth.signOut();router.replace('/login')}
  async function logEvent(eventType:string,severity:'info'|'warning'|'error'|'critical'='info',orderId?:string|null,message?:string|null,metadata:Record<string,unknown>={}){
    if(!ctx)return;
    try{await supabase.rpc('record_system_event',{p_tenant:ctx.tenant_id,p_event_type:eventType,p_severity:severity,p_order_id:orderId||null,p_device_id:'pdv-web',p_message:message||null,p_metadata:metadata});}catch{}
  }
  async function persistTerminal(id:string){
    setTerminalId(id);
    if(!ctx||ctx.role!=='owner')return;
    const t=terminals.find(x=>x.id===id);
    await supabase.rpc('set_selected_terminal',{p_tenant:ctx.tenant_id,p_terminal_id:id,p_terminal_label:t?.label||id});
  }

  async function setupTerminal(){
    if(!ctx||ctx.role!=='owner'||!terminalId)return;
    setBusy(true);setMessage('Configurando maquineta no modo PDV...');
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Sessão expirada.');
      const res=await fetch('/api/point/setup',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({terminalId})});
      const body=await res.json();if(!res.ok)throw new Error(body.error||'Falha ao configurar maquineta.');
      setMessage('Maquineta configurada no modo PDV. Reinicie o terminal se o Mercado Pago solicitar.');
      await load();
    }catch(e:any){setMessage(e?.message||'Falha ao configurar maquineta.');}
    finally{setBusy(false);}
  }

  async function readOrder(orderId:string,key:string,token:string){
    const res=await fetch(`/api/point/order/${encodeURIComponent(orderId)}?k=${encodeURIComponent(key)}`,{
      headers:{Authorization:`Bearer ${token}`},cache:'no-store'
    });
    const body=await res.json(); if(!res.ok)throw new Error(body.error||'Falha ao consultar venda');
    return body as PosOrder;
  }

  async function charge(){
    if(!ctx||!lines.length||!terminalId||busy)return;
    setBusy(true);setPhase('sending');setMessage('Criando venda e enviando cobrança para a maquineta...');
    try{
      const {data:{session}}=await supabase.auth.getSession(); if(!session)throw new Error('Sessão expirada.');
      const {data:o,error:oErr}=await supabase.rpc('create_pos_order',{
        p_tenant_slug:ctx.tenant_slug,
        p_items:lines.map(l=>({product_id:l.id,quantity:l.quantity}))
      });
      if(oErr||!o)throw oErr||new Error('Falha ao criar venda.');
      const chargeRes=await fetch('/api/point/charge',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({orderId:o.id,accessKey:o.access_key,terminalId})
      });
      const chargeBody=await chargeRes.json();
      if(!chargeRes.ok)throw new Error(chargeBody.error||'Falha ao enviar cobrança.');
      setPhase('waiting');
      setMessage(chargeBody.demo?'Pagamento de demonstração aprovado. Preparando tickets...':'Cobrança enviada. Conclua o pagamento na maquineta.');

      for(let i=0;i<90;i++){
        const current=await readOrder(o.id,o.access_key,session.access_token);
        if(current.order.status==='paid'){
          setPhase('paid');setMessage('Pagamento confirmado. Abrindo fila de impressão...');
          await sleep(550);
          router.push(`/imprimir/${encodeURIComponent(o.id)}?k=${encodeURIComponent(o.access_key)}&auto=1`);
          return;
        }
        if(['cancelled','expired'].includes(current.order.status)){
          throw new Error(current.order.last_error||'Pagamento cancelado ou expirado.');
        }
        await sleep(2000);
      }
      throw new Error('Pagamento ainda não confirmado. A venda ficou registrada e pode ser consultada sem cobrar novamente.');
    }catch(e:any){
      const msg=e?.message||'Falha ao processar a venda.';
      await logEvent('SALE_FLOW_ERROR','error',null,msg,{phase});
      setPhase('error');setMessage(msg);setBusy(false);
    }
  }

  return <div className="posShell">
    <header className="posTop"><BrandLogo compact/><div className="row"><span className={`netBadge ${online?'netOk':'netOff'}`}>{online?<Wifi size={15}/>:<WifiOff size={15}/>} {online?'Online':'Sem internet'}</span><button className="btn btnGhost btnSmall" onClick={logout}><LogOut size={15}/> Sair</button></div></header>
    <main className="posMain">
      <section className="posCatalog">
        <div className="posTitleRow"><div><span className="kicker dark">PDV · DIVERSÕES VENEZA</span><h1>Nova venda</h1><p>{ctx?.full_name||'Operador'} · toque nos produtos para montar o pedido.</p></div><button className="btn btnGhost" onClick={load} disabled={loading||busy}><RefreshCw size={17}/> Atualizar</button></div>
        {message&&<div className={`notice ${phase==='error'?'noticeError':phase==='paid'?'noticeSuccess':''}`}>{message}</div>}
        {loading?<div className="card">Carregando PDV...</div>:<div className="posProductGrid">{products.map(p=><button key={p.id} className="posProduct" onClick={()=>qty(p.id,1)} disabled={busy}>
          <div><span className="productBadge">{p.tickets_per_unit>1?'COMBO':'INGRESSO'}</span><h2>{p.name}</h2><p>{p.description||`${p.tickets_per_unit} ticket(s)`}</p></div><strong>{money(p.price_cents)}</strong>
        </button>)}</div>}
      </section>

      <aside className="posCart">
        <div className="posCartHead"><div><ShoppingCart size={22}/><strong>Venda atual</strong></div><span>{ticketCount} ticket{ticketCount!==1?'s':''}</span></div>
        <div className="posLines">{!lines.length?<div className="emptyCart">Nenhum item adicionado.</div>:lines.map(l=><div className="posLine" key={l.id}><div><strong>{l.name}</strong><span>{money(l.price_cents)} · {l.tickets_per_unit*l.quantity} ticket{l.tickets_per_unit*l.quantity!==1?'s':''}</span></div><div className="qty"><button onClick={()=>qty(l.id,-1)} disabled={busy}>−</button><strong>{l.quantity}</strong><button onClick={()=>qty(l.id,1)} disabled={busy}>+</button></div></div>)}</div>
        <div className="posTotal"><span>Total</span><strong>{money(total)}</strong></div>
        <div className="field"><label>Maquineta</label><select className="select" value={terminalId} onChange={e=>persistTerminal(e.target.value)} disabled={busy}>{terminals.length?terminals.map(t=><option key={t.id} value={t.id}>{t.label||t.id}{t.operating_mode?` · ${t.operating_mode}`:''}</option>):<option value="">Nenhuma disponível</option>}</select></div>
        {ctx?.role==='owner'&&terminalId&&terminals.find(t=>t.id===terminalId)?.operating_mode!=='PDV'&&<button className="btn btnGhost" onClick={setupTerminal} disabled={busy}>Ativar modo PDV nesta maquineta</button>}
        <div className="posFlowHint"><CreditCard size={18}/><span>O sistema envia o valor à maquineta. Só depois da confirmação do pagamento os tickets entram na fila de impressão.</span></div>
        <button className="btn btnPrimary posCharge" onClick={charge} disabled={!lines.length||!terminalId||busy}>{busy?<><RefreshCw className="spin" size={18}/>{phase==='waiting'?'Aguardando pagamento...':'Enviando...'}</>:<><CreditCard size={19}/> Cobrar {money(total)}</>}</button>
        <div className="posSafety"><Printer size={16}/><span>Se a impressão falhar depois do pagamento, a venda continua paga e poderá ser reimpressa. Nunca cobre novamente por falha da impressora.</span></div>
      </aside>
    </main>
  </div>;
}
