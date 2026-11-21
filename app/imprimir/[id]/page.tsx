'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Printer, RotateCcw, TriangleAlert } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';

type Job={job_id:string;status:'pending'|'printing'|'printed'|'failed';attempts:number;last_error?:string|null;ticket_id:string;ticket_code:string;sequence:number;product_name:string;printed_at?:string|null};
type Data={order:{id:string;status:string;total_cents:number;print_status:string;paid_at?:string|null;payment_method?:string|null};print_jobs:Job[]};

export default function PrintPage(){
  const {id}=useParams<{id:string}>(); const sp=useSearchParams(); const key=sp.get('k')||''; const auto=sp.get('auto')==='1'; const router=useRouter();
  const autoTriggered=useRef(false);
  const [data,setData]=useState<Data|null>(null); const [error,setError]=useState(''); const [printing,setPrinting]=useState(false); const [confirming,setConfirming]=useState(false);
  const load=useCallback(async()=>{
    const {data:{session}}=await supabase.auth.getSession();if(!session){router.replace('/login');return;}
    const {data,error}=await supabase.rpc('get_pos_order',{p_order_id:id,p_access_key:key});
    if(error||!data){setError('Venda não encontrada.');return;} setData(data as Data);
  },[id,key,router]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{if(auto&&data?.order.status==='paid'&&data.print_jobs.length&&!autoTriggered.current){autoTriggered.current=true;const t=setTimeout(()=>{setPrinting(true);window.print();setPrinting(false)},700);return()=>clearTimeout(t)}},[auto,data]);

  const pending=useMemo(()=>data?.print_jobs.filter(j=>j.status!=='printed')||[],[data]);
  async function logEvent(eventType:string,severity:'info'|'warning'|'error'|'critical'='info',message?:string|null,metadata:Record<string,unknown>={}){
    const {data:ctx}=await supabase.rpc('get_my_context');if(!ctx)return;
    try{await supabase.rpc('record_system_event',{p_tenant:ctx.tenant_id,p_event_type:eventType,p_severity:severity,p_order_id:id,p_device_id:'pdv-web',p_message:message||null,p_metadata:metadata});}catch{}
  }
  async function printNow(){await logEvent('PRINT_DIALOG_OPENED','info','Janela de impressão aberta',{tickets:data?.print_jobs.length||0});window.print();}
  async function confirmAll(){
    if(!data)return;setConfirming(true);setError('');
    for(const j of pending){const {error}=await supabase.rpc('mark_print_job_printed',{p_job_id:j.job_id});if(error){setError(error.message);await logEvent('PRINT_CONFIRM_ERROR','error',error.message,{job_id:j.job_id});break;}}
    await logEvent('PRINT_CONFIRMED','info','Operador confirmou impressão dos tickets',{jobs:pending.length});
    await load();setConfirming(false);
  }
  async function reprint(j:Job){
    await supabase.rpc('reset_print_job',{p_job_id:j.job_id});await logEvent('PRINT_RETRY','warning','Reimpressão solicitada',{job_id:j.job_id,ticket_code:j.ticket_code});await load();setTimeout(()=>window.print(),200);
  }

  if(error&&!data)return <main className="authWrap"><div className="authCard"><BrandLogo/><div className="notice noticeError">{error}</div></div></main>;
  return <div className="printShell">
    <div className="printControls noPrint"><BrandLogo compact/><div className="printControlCard">
      <h1>{data?.order.print_status==='printed'?'Venda concluída':'Impressão de tickets'}</h1>
      <p>{data?.print_jobs.length||0} ticket{data?.print_jobs.length===1?'':'s'} nesta venda. Cada ingresso é uma unidade física separada.</p>
      {data?.order.print_status==='printed'?<div className="notice noticeSuccess"><CheckCircle2 size={17}/> Todos os tickets foram marcados como impressos.</div>:<div className="notice noticeWarn"><TriangleAlert size={17}/> O pagamento já está confirmado. Se a impressora falhar, não refaça a cobrança: use reimpressão.</div>}
      {error&&<div className="notice noticeError">{error}</div>}
      <div className="row" style={{marginTop:16}}><button className="btn btnPrimary" onClick={printNow} disabled={!data?.print_jobs.length}><Printer size={18}/> Imprimir tickets</button>{pending.length>0&&<button className="btn btnDark" onClick={confirmAll} disabled={confirming}>{confirming?'Confirmando...':'Confirmar impressão concluída'}</button>}<button className="btn btnGhost" onClick={()=>router.push('/pdv')}>Nova venda</button></div>
      {data?.print_jobs.some(j=>j.status==='failed')&&<div className="stack" style={{marginTop:14}}>{data.print_jobs.filter(j=>j.status==='failed').map(j=><button key={j.job_id} className="btn btnGhost" onClick={()=>reprint(j)}><RotateCcw size={16}/> Reimprimir {j.product_name} · #{j.sequence}</button>)}</div>}
    </div></div>

    <main className="ticketPaper">{data?.print_jobs.map((j,idx)=><section className="physicalTicket" key={j.job_id}>
      <div className="ticketBrand">DIVERSÕES <strong>VENEZA</strong></div>
      <div className="ticketRule"/>
      <h2>{j.product_name}</h2>
      <div className="admission">1 ENTRADA</div>
      <div className="ticketMeta"><span>Ticket</span><b>{idx+1}/{data.print_jobs.length}</b></div>
      <div className="ticketMeta"><span>Venda</span><b>{data.order.id.slice(0,8).toUpperCase()}</b></div>
      <div className="ticketMeta"><span>Data</span><b>{data.order.paid_at?new Date(data.order.paid_at).toLocaleString('pt-BR'):'—'}</b></div>
      <div className="ticketCode">{j.ticket_code}</div>
      <p>Válido para uma utilização. Guarde este ticket até o acesso ao brinquedo.</p>
      <div className="cutLine">CORTE</div>
    </section>)}</main>
  </div>;
}
