'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock3, CreditCard, RotateCw } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { QrTicket } from '@/components/QrTicket';
import { supabase } from '@/lib/supabase';

type PublicOrder = {
  order:{id:string;status:string;total_cents:number;buyer_name?:string;is_demo:boolean;created_at:string;paid_at?:string};
  items:Array<{id:string;product_name:string;unit_price_cents:number;quantity:number;tickets_per_unit:number}>;
  tickets:Array<{id:string;code:string;status:string;sequence:number;used_at?:string;product_name:string}>;
};
function money(c:number){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100)}

export default function OrderPage(){
  const {id}=useParams<{id:string}>(); const sp=useSearchParams(); const key=sp.get('k')||'';
  const [data,setData]=useState<PublicOrder|null>(null); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    if(!id||!key)return;
    const {data,error}=await supabase.rpc('get_order_public',{p_order_id:id,p_access_key:key});
    if(error||!data){setError('Pedido não encontrado ou link inválido.');return;}
    setData(data as PublicOrder);
  },[id,key]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{
    if(data?.order.status!=='pending_payment')return;
    const t=setInterval(load,4000); return()=>clearInterval(t);
  },[data?.order.status,load]);

  async function demoPay(){
    setBusy(true); setError('');
    const {error}=await supabase.rpc('demo_approve_order',{p_order_id:id,p_access_key:key});
    if(error)setError(error.message); else await load();
    setBusy(false);
  }
  async function realPay(){
    setBusy(true); setError('');
    try{
      const res=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:id,accessKey:key})});
      const out=await res.json();
      if(!res.ok)throw new Error(out.error||'Pagamento indisponível');
      window.location.href=out.checkoutUrl;
    }catch(e:any){setError(e.message);setBusy(false);}
  }

  if(!data)return <><header className="siteHeader"><div className="headerInner"><BrandLogo compact/></div></header><main className="container orderPage"><div className="card">{error||'Carregando pedido...'}</div></main></>;
  const paid=data.order.status==='paid';
  return <>
    <header className="siteHeader"><div className="headerInner"><a href="/"><BrandLogo compact/></a><a className="btn btnGhost btnSmall" href="/">Nova compra</a></div></header>
    <main className="container orderPage">
      <div className="orderHeader"><div><div className={`statusPill ${paid?'statusPaid':'statusPending'}`}>{paid?'Pagamento confirmado':'Aguardando pagamento'}</div><h1>Pedido #{data.order.id.slice(0,8).toUpperCase()}</h1><p className="muted">Total: <strong>{money(data.order.total_cents)}</strong></p></div>{paid?<CheckCircle2 size={48} color="#1f9d68"/>:<Clock3 size={48} color="#ff9b38"/>}</div>
      {error&&<div className="notice noticeError" style={{marginBottom:16}}>{error}</div>}
      {!paid&&<section className="card" style={{marginBottom:20}}>
        <h2 style={{marginTop:0}}>Finalizar pagamento</h2>
        {data.order.is_demo ? <>
          <div className="notice noticeWarn" style={{marginBottom:14}}><strong>Modo demonstração.</strong> Nenhuma cobrança real será feita. Use este botão para testar emissão e validação dos QR Codes.</div>
          <button className="btn btnPrimary" disabled={busy} onClick={demoPay}><CreditCard size={18}/>{busy?'Processando...':'Simular pagamento aprovado'}</button>
        </> : <>
          <p className="muted">Você será direcionado para o ambiente seguro do Mercado Pago.</p>
          <button className="btn btnPrimary" disabled={busy} onClick={realPay}><CreditCard size={18}/>{busy?'Abrindo checkout...':'Pagar com Mercado Pago'}</button>
        </>}
        <button className="btn btnGhost" style={{marginLeft:8}} onClick={load}><RotateCw size={16}/> Atualizar</button>
      </section>}
      {paid&&<>
        <div className="notice"><strong>Compra concluída.</strong> Cada QR Code abaixo vale uma entrada em um brinquedo e só pode ser utilizado uma vez.</div>
        <div className="ticketGrid">{data.tickets.map((t,i)=><QrTicket key={t.id} code={t.code} product={t.product_name} index={i+1} status={t.status}/>)}</div>
      </>}
    </main>
  </>;
}
