'use client';

import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

type Status = { app:boolean;database:boolean;products:number;mercadoPagoApp:boolean;webhookSignature:boolean;tenant:string;siteUrl:string|null };
export default function StatusPage(){
  const [data,setData]=useState<Status|null>(null);
  useEffect(()=>{fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).then(setData).catch(()=>setData(null))},[]);
  const Row=({ok,label,detail}:{ok:boolean;label:string;detail?:string})=><div className="row space" style={{padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,.09)'}}><div><strong>{label}</strong>{detail&&<div className="muted small">{detail}</div>}</div><span className={`statusPill ${ok?'statusPaid':'statusPending'}`}>{ok?'OK':'PENDENTE'}</span></div>;
  return <main className="authWrap"><div className="authCard" style={{maxWidth:620}}><BrandLogo/><h1>Status do MVP</h1><p>Checklist técnico do PDV físico e da integração de pagamentos.</p>{!data?<p>Verificando...</p>:<><Row ok={data.app} label="Aplicação"/><Row ok={data.database} label="Banco Supabase" detail={`${data.products} produto(s) ativo(s)`}/><Row ok={data.mercadoPagoApp} label="Aplicação Mercado Pago" detail="OAuth do vendedor + Mercado Pago Point / Orders API"/><Row ok={data.webhookSignature} label="Assinatura de Webhook" detail="Recomendada antes de ativar cobrança real"/><div className="notice noticeWarn" style={{marginTop:18}}>Enquanto o Mercado Pago não estiver configurado e conectado pelo dono, o PDV permanece em modo demonstração e nenhuma cobrança real é feita.</div></>}<a className="btn btnGhost" href="/" style={{marginTop:18}}>Voltar para o PDV</a></div></main>;
}
