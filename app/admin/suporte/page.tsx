'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, AlertTriangle, CheckCircle2, Printer, RefreshCw, RotateCcw, ShoppingCart } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';

type Ctx={user_id:string;tenant_id:string;role:'owner'|'cashier'|'staff';tenant_name:string;tenant_slug:string;demo_mode:boolean;full_name?:string;email?:string};
type Health={errors_24h:number;failed_print_jobs:number;pending_print_jobs:number;recent_events:Array<{id:string;event_type:string;severity:string;message?:string|null;order_id?:string|null;device_id?:string|null;created_at:string}>};
type PrintJob={id:string;status:string;attempts:number;last_error?:string|null;order_id:string;ticket?:{code?:string;sequence?:number;order_item?:{product_name?:string}|null}|null};

function severityLabel(value:string){
  if(value==='critical')return 'Crítico';
  if(value==='error')return 'Erro';
  if(value==='warning')return 'Atenção';
  return 'Info';
}

export default function SupportPage(){
  const router=useRouter();
  const [ctx,setCtx]=useState<Ctx|null>(null);
  const [health,setHealth]=useState<Health>({errors_24h:0,failed_print_jobs:0,pending_print_jobs:0,recent_events:[]});
  const [jobs,setJobs]=useState<PrintJob[]>([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){router.replace('/login');return;}
    const {data:c,error:cErr}=await supabase.rpc('get_my_context');
    if(cErr||!c||c.role!=='owner'){router.replace(c?.role==='cashier'?'/pdv':c?.role==='staff'?'/portaria':'/login');return;}
    setCtx(c as Ctx);
    const [h,j]=await Promise.all([
      supabase.rpc('admin_health_summary',{p_tenant:c.tenant_id}),
      supabase.from('print_jobs')
        .select('id,status,attempts,last_error,order_id,ticket:tickets(code,sequence,order_item:order_items(product_name))')
        .eq('tenant_id',c.tenant_id)
        .in('status',['failed','pending','printing'])
        .order('updated_at',{ascending:false})
        .limit(50)
    ]);
    if(h.error)setMessage(h.error.message); else if(h.data)setHealth(h.data as Health);
    if(j.error)setMessage(v=>v||j.error!.message); else setJobs((j.data||[]) as unknown as PrintJob[]);
    setLoading(false);
  },[router]);

  useEffect(()=>{load()},[load]);

  const state=useMemo(()=>{
    if(health.errors_24h>0||health.failed_print_jobs>0)return {label:'Atenção necessária',kind:'warn'};
    if(health.pending_print_jobs>0)return {label:'Operação em andamento',kind:'pending'};
    return {label:'Operação normal',kind:'ok'};
  },[health]);

  async function retry(job:PrintJob){
    setMessage('');
    const {error}=await supabase.rpc('reset_print_job',{p_job_id:job.id});
    if(error){setMessage(error.message);return;}
    setMessage('Ticket devolvido à fila de impressão. Abra a venda no PDV para concluir a reimpressão.');
    await load();
  }

  return <div className="adminLayout">
    <header className="adminTop"><div className="headerInner"><BrandLogo compact/><div className="row"><a className="btn btnGhost btnSmall" href="/admin">Painel</a><a className="btn btnGhost btnSmall" href="/pdv"><ShoppingCart size={15}/> PDV</a></div></div></header>
    <main className="container adminMain">
      <div className="adminHero"><div><span className="kicker dark">SUPORTE OPERACIONAL</span><h1>Diagnóstico do sistema</h1><p>{ctx?.tenant_name} · telemetria das últimas operações</p></div><button className="btn btnGhost" onClick={load} disabled={loading}><RefreshCw size={16}/> Atualizar</button></div>
      {message&&<div className="notice" style={{marginBottom:18}}>{message}</div>}

      <section className="metrics">
        <div className="metric"><small>Estado geral</small><strong style={{fontSize:22}}>{state.label}</strong></div>
        <div className="metric"><small>Erros em 24h</small><strong>{health.errors_24h}</strong></div>
        <div className="metric"><small>Impressões com falha</small><strong>{health.failed_print_jobs}</strong></div>
        <div className="metric"><small>Impressões pendentes</small><strong>{health.pending_print_jobs}</strong></div>
      </section>

      <div className="adminGrid">
        <section className="adminCard full">
          <div className="row space"><div><h2>Fila de impressão</h2><p className="muted small">Pagamento aprovado nunca deve ser repetido por causa de falha na impressora.</p></div><Printer size={22}/></div>
          {jobs.length===0?<div className="notice noticeSuccess"><CheckCircle2 size={17}/> Nenhuma impressão pendente ou com falha.</div>:<div className="tableWrap"><table><thead><tr><th>Venda</th><th>Ticket</th><th>Status</th><th>Tentativas</th><th>Erro</th><th></th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>{j.order_id.slice(0,8).toUpperCase()}</td><td>{j.ticket?.order_item?.product_name||'Ingresso'} {j.ticket?.sequence?`#${j.ticket.sequence}`:''}<br/><span className="muted small">{j.ticket?.code||''}</span></td><td>{j.status}</td><td>{j.attempts}</td><td>{j.last_error||'—'}</td><td>{j.status==='failed'?<button className="btn btnGhost btnSmall" onClick={()=>retry(j)}><RotateCcw size={14}/> Reenviar</button>:'—'}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="adminCard full">
          <div className="row space"><div><h2>Eventos recentes</h2><p className="muted small">Base para o futuro suporte inteligente com diagnóstico assistido por IA.</p></div><Activity size={22}/></div>
          {health.recent_events.length===0?<div className="notice"><CheckCircle2 size={17}/> Nenhum evento operacional recente.</div>:<div className="tableWrap"><table><thead><tr><th>Data</th><th>Severidade</th><th>Evento</th><th>Venda</th><th>Mensagem</th></tr></thead><tbody>{health.recent_events.map(e=><tr key={e.id}><td>{new Date(e.created_at).toLocaleString('pt-BR')}</td><td>{e.severity==='error'||e.severity==='critical'?<span className="row"><AlertTriangle size={14}/>{severityLabel(e.severity)}</span>:severityLabel(e.severity)}</td><td>{e.event_type}</td><td>{e.order_id?e.order_id.slice(0,8).toUpperCase():'—'}</td><td>{e.message||'—'}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </main>
  </div>;
}
