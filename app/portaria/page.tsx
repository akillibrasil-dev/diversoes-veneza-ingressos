'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';
import { Camera, LogOut, RotateCcw } from 'lucide-react';

type Ctx={tenant_id:string;role:'owner'|'staff';tenant_name:string;full_name?:string};
type Attraction={id:string;name:string;active:boolean};
type Result={result:string;used_at?:string;validated_at?:string;attraction?:string};

function normalizeCode(raw:string){
  const v=raw.trim();
  try{const u=new URL(v);return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||v).toUpperCase()}catch{}
  return v.replace(/^DV:/i,'').toUpperCase();
}

export default function PortariaPage(){
  const router=useRouter(); const scannerRef=useRef<any>(null);
  const [ctx,setCtx]=useState<Ctx|null>(null); const [attractions,setAttractions]=useState<Attraction[]>([]); const [attraction,setAttraction]=useState('');
  const [code,setCode]=useState(''); const [result,setResult]=useState<Result|null>(null); const [error,setError]=useState(''); const [cameraOn,setCameraOn]=useState(false);

  useEffect(()=>{(async()=>{
    const {data:{session}}=await supabase.auth.getSession(); if(!session){router.replace('/login');return;}
    const {data:c}=await supabase.rpc('get_my_context'); if(!c){router.replace('/login');return;} setCtx(c as Ctx);
    const {data}=await supabase.from('attractions').select('id,name,active').eq('tenant_id',c.tenant_id).eq('active',true).order('name');
    setAttractions((data||[]) as Attraction[]); if(data?.[0])setAttraction(data[0].id);
  })(); return()=>{scannerRef.current?.clear?.().catch?.(()=>{})}},[router]);

  async function validate(raw:string){
    if(!attraction){setError('Selecione a atração.');return;}
    const c=normalizeCode(raw); if(!c)return; setError(''); setResult(null);
    const {data,error}=await supabase.rpc('validate_ticket',{p_code:c,p_attraction_id:attraction});
    if(error){setError(error.message);return;} setResult(data as Result); setCode('');
  }

  async function startCamera(){
    if(cameraOn)return;
    if(!attraction){setError('Selecione a atração antes de abrir a câmera.');return;}
    setError(''); setResult(null);
    const {Html5QrcodeScanner}=await import('html5-qrcode');
    const scanner=new Html5QrcodeScanner('reader',{fps:10,qrbox:{width:240,height:240},rememberLastUsedCamera:true},false);
    scannerRef.current=scanner; setCameraOn(true);
    scanner.render(async(decoded)=>{await validate(decoded); try{await scanner.clear()}catch{} scannerRef.current=null; setCameraOn(false);},()=>{});
  }
  async function resetScanner(){try{await scannerRef.current?.clear?.()}catch{}scannerRef.current=null;setCameraOn(false);setResult(null);setError('')}
  async function logout(){await supabase.auth.signOut();router.replace('/login')}
  function submit(e:FormEvent){e.preventDefault();validate(code)}

  const cls=result?.result==='valid'?'resultValid':result?.result==='already_used'?'resultUsed':'resultInvalid';
  const text=result?.result==='valid'?'ENTRADA LIBERADA':result?.result==='already_used'?'INGRESSO JÁ UTILIZADO':result?.result==='cancelled'?'INGRESSO CANCELADO':'INGRESSO INVÁLIDO';

  return <main className="staffPage"><div className="staffWrap">
    <div className="staffHeader"><BrandLogo compact/><button className="btn btnGhost btnSmall" onClick={logout}><LogOut size={15}/> Sair</button></div>
    <section className="staffCard">
      <h1 style={{marginTop:0}}>Validação de ingressos</h1><p className="muted">{ctx?.full_name||'Equipe'} · selecione o brinquedo e leia o QR Code.</p>
      <div className="field" style={{marginBottom:14}}><label>Atração</label><select className="select" value={attraction} onChange={e=>{setAttraction(e.target.value);setResult(null)}}><option value="">Selecione</option>{attractions.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      {error&&<div className="notice noticeError" style={{marginBottom:14}}>{error}</div>}
      {!result&&<>
        <div className="scannerBox"><div id="reader" style={{width:'100%'}}>{!cameraOn&&<button className="btn btnPrimary" onClick={startCamera}><Camera size={18}/> Abrir câmera</button>}</div></div>
        <form className="row" style={{marginTop:14}} onSubmit={submit}><input className="input" style={{flex:1}} placeholder="Ou digite/cole o código" value={code} onChange={e=>setCode(e.target.value)}/><button className="btn btnDark">Validar</button></form>
      </>}
      {result&&<><div className={`validationResult ${cls}`}>{text}{result.attraction&&<div style={{fontSize:15,marginTop:8,fontWeight:700}}>{result.attraction}</div>}{result.used_at&&<div style={{fontSize:13,marginTop:6,fontWeight:600}}>Usado em {new Date(result.used_at).toLocaleString('pt-BR')}</div>}</div><button className="btn btnDark" style={{width:'100%',marginTop:14}} onClick={resetScanner}><RotateCcw size={17}/> Ler próximo ingresso</button></>}
    </section>
  </div></main>;
}
