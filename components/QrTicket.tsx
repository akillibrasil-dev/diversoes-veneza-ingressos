'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function QrTicket({ code, product, index, status }: { code: string; product: string; index: number; status: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const value = `${window.location.origin}/t/${encodeURIComponent(code)}`;
    QRCode.toDataURL(value, { width: 360, margin: 2, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [code]);
  return (
    <article className={`ticketCard ${status !== 'valid' ? 'ticketUsed' : ''}`}>
      <div className="ticketTop"><span>Ingresso {index}</span><b>{status === 'valid' ? 'VÁLIDO' : status === 'used' ? 'UTILIZADO' : 'CANCELADO'}</b></div>
      <h3>{product}</h3>
      {src && <img className="qrImage" src={src} alt={`QR Code do ingresso ${index}`} />}
      <code>{code}</code>
      <p>Apresente este QR Code na entrada do brinquedo.</p>
    </article>
  );
}
