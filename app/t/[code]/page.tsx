'use client';
import { useParams } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { QrTicket } from '@/components/QrTicket';
export default function TicketDisplay(){
  const {code}=useParams<{code:string}>();
  return <main className="authWrap"><div style={{width:'min(420px,100%)'}}><div style={{display:'flex',justifyContent:'center',marginBottom:16}}><BrandLogo/></div><QrTicket code={decodeURIComponent(code)} product="Ingresso Diversões Veneza" index={1} status="valid"/></div></main>;
}
