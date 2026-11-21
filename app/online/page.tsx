'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Ticket, ShieldCheck, LogIn } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

type Product = { id:string; name:string; description:string|null; price_cents:number; tickets_per_unit:number; sort_order:number };
type Cart = Record<string, number>;

function money(cents:number){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100); }

export default function Home(){
  const router = useRouter();
  const [products,setProducts]=useState<Product[]>([]);
  const [cart,setCart]=useState<Cart>({});
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [phone,setPhone]=useState('');
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    (async()=>{
      const slug=process.env.NEXT_PUBLIC_TENANT_SLUG || 'diversoes-veneza';
      const {data:tenant,error:tErr}=await supabase.from('tenants').select('id').eq('slug',slug).single();
      if(tErr || !tenant){ setError('Não foi possível carregar a bilheteria.'); setLoading(false); return; }
      const {data,error:pErr}=await supabase.from('products').select('id,name,description,price_cents,tickets_per_unit,sort_order').eq('tenant_id',tenant.id).eq('active',true).order('sort_order');
      if(pErr) setError('Não foi possível carregar os ingressos.');
      else setProducts((data||[]) as Product[]);
      setLoading(false);
    })();
  },[]);

  const lines=useMemo(()=>products.filter(p=>(cart[p.id]||0)>0).map(p=>({...p,quantity:cart[p.id]})),[products,cart]);
  const total=lines.reduce((s,l)=>s+l.price_cents*l.quantity,0);
  const ticketCount=lines.reduce((s,l)=>s+l.tickets_per_unit*l.quantity,0);

  function setQty(id:string,delta:number){
    setCart(c=>({...c,[id]:Math.max(0,(c[id]||0)+delta)}));
  }

  async function checkout(){
    if(!lines.length) return;
    setCreating(true); setError('');
    try{
      const {data,error}=await supabase.rpc('create_public_order',{
        p_tenant_slug: process.env.NEXT_PUBLIC_TENANT_SLUG || 'diversoes-veneza',
        p_items: lines.map(l=>({product_id:l.id,quantity:l.quantity})),
        p_buyer_name:name||null,p_buyer_email:email||null,p_buyer_phone:phone||null,
      });
      if(error) throw error;
      router.push(`/pedido/${data.id}?k=${encodeURIComponent(data.access_key)}`);
    }catch(e:any){ setError(e?.message || 'Falha ao criar pedido.'); setCreating(false); }
  }

  return <>
    <header className="siteHeader"><div className="headerInner">
      <BrandLogo compact />
      <div className="headerActions"><a className="btn btnGhost btnSmall" href="/login"><LogIn size={16}/> Área da equipe</a></div>
    </div></header>

    <section className="hero"><div className="container heroContent">
      <span className="kicker"><Ticket size={15}/> INGRESSO DIGITAL</span>
      <h1>Diversão sem fila para comprar <span>ticket.</span></h1>
      <p>Escolha seus ingressos, pague online e receba seus QR Codes na hora. Na entrada do brinquedo, é só apresentar o celular.</p>
    </div></section>

    <main className="container section">
      <h2 className="sectionTitle">Escolha seu ingresso</h2>
      <p className="sectionLead">Preço único para todos os brinquedos. Cada ingresso pode ser usado uma vez.</p>
      {error && <div className="notice noticeError">{error}</div>}
      {loading ? <div className="card">Carregando...</div> : <div className="productGrid">
        {products.map((p,i)=><article className="card productCard" key={p.id}>
          <span className="productBadge">{i===1?'PROMOÇÃO':'INGRESSO'}</span>
          <h2>{p.name}</h2>
          <div className="price">{money(p.price_cents)}</div>
          <p>{p.description || `${p.tickets_per_unit} ingresso(s)`}</p>
          <div className="quantityRow">
            <div className="qty"><button aria-label="diminuir" onClick={()=>setQty(p.id,-1)}>−</button><strong>{cart[p.id]||0}</strong><button aria-label="aumentar" onClick={()=>setQty(p.id,1)}>+</button></div>
            <span className="muted small">{p.tickets_per_unit} ticket{p.tickets_per_unit>1?'s':''}</span>
          </div>
        </article>)}
      </div>}

      {lines.length>0 && <section className="card cartPanel">
        <div className="cartHeader"><div><h2 style={{margin:0}}>Seu pedido</h2><span className="muted small">{ticketCount} ingresso{ticketCount!==1?'s':''} digital{ticketCount!==1?'is':''}</span></div><ShoppingCart size={26}/></div>
        <div className="cartItems">{lines.map(l=><div className="cartLine" key={l.id}><span>{l.quantity}× {l.name}</span><strong>{money(l.price_cents*l.quantity)}</strong></div>)}</div>
        <div className="row space" style={{marginBottom:18}}><span>Total</span><span className="cartTotal">{money(total)}</span></div>
        <div className="formGrid">
          <div className="field"><label>Nome</label><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Seu nome"/></div>
          <div className="field"><label>Telefone</label><input className="input" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(81) 99999-9999"/></div>
          <div className="field full"><label>E-mail</label><input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@email.com"/></div>
        </div>
        <div className="notice" style={{margin:'16px 0'}}><ShieldCheck size={16} style={{verticalAlign:'middle',marginRight:6}}/> O pagamento será processado pelo Mercado Pago quando a conta do parque estiver conectada. No ambiente de teste, você poderá simular a aprovação.</div>
        <button className="btn btnPrimary" style={{width:'100%'}} disabled={creating} onClick={checkout}>{creating?'Criando pedido...':'Continuar para pagamento'}</button>
      </section>}
    </main>
    <footer className="footer"><div className="container">Diversões Veneza · Ingressos digitais · Tecnologia Akilli Brasil</div></footer>
  </>;
}
