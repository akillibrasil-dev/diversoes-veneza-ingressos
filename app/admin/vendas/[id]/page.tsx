'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock3, Printer, ReceiptText, RefreshCw, UserRound } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';

type Ctx={user_id:string;tenant_id:string;role:'owner'|'cashier'|'staff';tenant_name:string;tenant_slug:string;demo_mode:boolean;full_name?:string;email?:string};
type Detail={
  order:{id:string;status:string;total_cents:number;buyer_name?:string|null;buyer_email?:string|null;buyer_phone?:string|null;provider?:string|null;provider_order_id?:string|null;provider_payment_id?:string|null;payment_method?:string|null;sale_channel:string;is_demo:boolean;print_status:string;terminal_id?:string|null;last_error?:string|null;created_at:string;paid_at?:string|null;completed_at?:string|null;operator_id?:string|null};
  operator?:{id:string;full_name?:string|null;email?:string|null}|null;
  items:Array<{id:string;product_name:string;unit_price_cents:number;quantity:number;tickets_per_unit:number;created_at:string}>;
  payments:Array<{id:string;provider:string;provider_payment_id?:string|null;status:string;amount_cents?:number|null;created_at:string;updated_at:string}>;
  tickets:Array<{id:string;code:string;sequence:number;status:string;print_status:string;printed_at?:string|null;print_attempts:number;created_at:string;product_name:string}>;
  print_jobs:Array<{id:string;ticket_id:string;status:string;attempts:number;last_error?:string|null;requested_at:string;printed_at?:string|null}>;
  events:Array<{id:string;event_type:string;severity:string;message?:string|null;device_id?:string|null;metadata?:Record<string,unknown>;created_at:string;actor?:{id:string;full_name?:string|null;email?:string|null}|null}>;
};

const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
const when=(v?:string|null)=>v?new Date(v).toLocaleString('pt-BR'):'—';

export default function SaleDetailPage(){
  const params=useParams<{id:string}>();
  const router=useRouter();
  const [ctx,setCtx]=useState<Ctx|null>(null);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){router.replace('/login');return;}
    const {data:c,error:cErr}=await supabase.rpc('get_my_context');
    if(cErr||!c||c.role!=='owner'){router.replace(c?.role==='cashier'?'/pdv':c?.role==='staff'?'/portaria':'/login');return;}
    setCtx(c as Ctx);
    const {data,error}=await supabase.rpc('admin_order_detail',{p_order_id:params.id});
    if(error){setMessage(error.message);setDetail(null);} else setDetail(data as Detail);
    setLoading(false);
  },[params.id,router]);

  useEffect(()=>{load()},[load]);

  const ticketStats=useMemo(()=>{
    const total=detail?.tickets.length||0;
    const printed=detail?.tickets.filter(t=>t.print_status==='printed').length||0;
    const failed=detail?.tickets.filter(t=>t.print_status==='failed').length||0;
    return {total,printed,failed};
  },[detail]);

  if(loading)return <main className="authWrap"><div className="authCard"><BrandLogo/><p>Carregando venda...</p></div></main>;
  return <div className="adminLayout">
    <header className="adminTop"><div className="headerInner"><BrandLogo compact/><div className="row"><a className="btn btnGhost btnSmall" href="/admin"><ArrowLeft size={15}/> Painel</a><a className="btn btnGhost btnSmall" href="/pdv">PDV</a></div></div></header>
    <main className="container adminMain">
      <div className="adminHero"><div><span className="kicker dark">TRILHA DA VENDA</span><h1>Venda {params.id.slice(0,8).toUpperCase()}</h1><p>{ctx?.tenant_name} · histórico operacional completo</p></div><button className="btn btnGhost" onClick={load}><RefreshCw size={16}/> Atualizar</button></div>
      {message&&<div className="notice noticeError" style={{marginBottom:18}}>{message}</div>}
      {!detail?null:<>
        <section className="metrics">
          <div className="metric"><small>Total</small><strong>{money(detail.order.total_cents)}</strong></div>
          <div className="metric"><small>Pagamento</small><strong style={{fontSize:22}}>{detail.order.status}</strong></div>
          <div className="metric"><small>Impressão</small><strong style={{fontSize:22}}>{detail.order.print_status}</strong></div>
          <div className="metric"><small>Tickets</small><strong>{ticketStats.printed}/{ticketStats.total}</strong></div>
        </section>

        {detail.order.last_error&&<div className="notice noticeError" style={{marginBottom:18}}><strong>Último erro:</strong> {detail.order.last_error}</div>}

        <div className="adminGrid">
          <section className="adminCard"><div className="row space"><h2>Operação</h2><UserRound size={20}/></div><p><strong>Operador</strong><br/><span className="muted">{detail.operator?.full_name||detail.operator?.email||'Venda online / sistema'}</span></p><p><strong>Canal</strong><br/><span className="muted">{detail.order.sale_channel}</span></p><p><strong>Criada em</strong><br/><span className="muted">{when(detail.order.created_at)}</span></p><p><strong>Concluída em</strong><br/><span className="muted">{when(detail.order.completed_at)}</span></p></section>

          <section className="adminCard"><div className="row space"><h2>Pagamento</h2><ReceiptText size={20}/></div><p><strong>Provedor</strong><br/><span className="muted">{detail.order.provider||'—'}</span></p><p><strong>Método</strong><br/><span className="muted">{detail.order.payment_method||'—'}</span></p><p><strong>Terminal</strong><br/><span className="muted">{detail.order.terminal_id||'—'}</span></p><p><strong>Ordem do provedor</strong><br/><span className="muted small">{detail.order.provider_order_id||'—'}</span></p><p><strong>Pago em</strong><br/><span className="muted">{when(detail.order.paid_at)}</span></p></section>

          <section className="adminCard full"><h2>Itens</h2><div className="tableWrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Valor unitário</th><th>Tickets por unidade</th><th>Subtotal</th></tr></thead><tbody>{detail.items.map(i=><tr key={i.id}><td>{i.product_name}</td><td>{i.quantity}</td><td>{money(i.unit_price_cents)}</td><td>{i.tickets_per_unit}</td><td>{money(i.unit_price_cents*i.quantity)}</td></tr>)}</tbody></table></div></section>

          <section className="adminCard full"><div className="row space"><div><h2>Tickets físicos</h2><p className="muted small">Cada ingresso comprado mantém seu próprio código e estado de impressão.</p></div><Printer size={21}/></div>{detail.tickets.length===0?<div className="notice">Os tickets ainda não foram emitidos porque o pagamento não foi confirmado.</div>:<div className="tableWrap"><table><thead><tr><th>Ingresso</th><th>Código</th><th>Status</th><th>Impressão</th><th>Tentativas</th><th>Impresso em</th></tr></thead><tbody>{detail.tickets.map(t=><tr key={t.id}><td>{t.product_name} #{t.sequence}</td><td><span className="small">{t.code}</span></td><td>{t.status}</td><td>{t.print_status}</td><td>{t.print_attempts}</td><td>{when(t.printed_at)}</td></tr>)}</tbody></table></div>}</section>

          <section className="adminCard full"><div className="row space"><div><h2>Linha do tempo</h2><p className="muted small">Eventos técnicos e operacionais associados a esta venda.</p></div><Clock3 size={21}/></div>{detail.events.length===0?<div className="notice"><CheckCircle2 size={16}/> Nenhum evento registrado.</div>:<div className="tableWrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Operador</th><th>Severidade</th><th>Mensagem</th></tr></thead><tbody>{detail.events.map(e=><tr key={e.id}><td>{when(e.created_at)}</td><td>{e.event_type}</td><td>{e.actor?.full_name||e.actor?.email||'Sistema'}</td><td>{e.severity}</td><td>{e.message||'—'}</td></tr>)}</tbody></table></div>}</section>
        </div>
      </>}
    </main>
  </div>;
}
