import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafe(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cents(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.type && body.type !== "order") return Response.json({ ok: true });

    const u = new URL(req.url);
    const dataId = String(u.searchParams.get("data.id") || body?.data?.id || "");
    const userId = String(body?.user_id || "");
    if (!dataId || !userId) return Response.json({ ok: true });

    const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET") || "";
    if (webhookSecret) {
      const xSignature = req.headers.get("x-signature") || "";
      const requestId = req.headers.get("x-request-id") || "";
      const parts = Object.fromEntries(
        xSignature.split(",").map((part) => {
          const [k, ...rest] = part.trim().split("=");
          return [k, rest.join("=")];
        }),
      );
      const ts = String(parts.ts || "");
      const received = String(parts.v1 || "");
      if (!ts || !received) return new Response("invalid_signature", { status: 401 });
      const manifest =
        (dataId ? "id:" + dataId + ";" : "") +
        (requestId ? "request-id:" + requestId + ";" : "") +
        "ts:" + ts + ";";
      const expected = await hmacHex(webhookSecret, manifest);
      if (!timingSafe(received, expected)) return new Response("invalid_signature", { status: 401 });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: conn, error: connError } = await admin.rpc("service_connection_by_provider_user", {
      p_provider_user_id: userId,
    });
    if (connError || !conn?.access_token) return Response.json({ ok: true });

    const mpRes = await fetch(
      "https://api.mercadopago.com/v1/orders/" + encodeURIComponent(dataId),
      { headers: { Authorization: "Bearer " + conn.access_token } },
    );
    if (!mpRes.ok) return Response.json({ ok: false }, { status: 502 });

    const order = await mpRes.json();
    if (order?.type !== "point" || !order?.external_reference) return Response.json({ ok: true });

    const payment = order?.transactions?.payments?.[0] || {};
    const { error: confirmError } = await admin.rpc("service_confirm_point_order", {
      p_external_reference: String(order.external_reference),
      p_provider_order_id: String(order.id || dataId),
      p_status: String(order.status || "unknown"),
      p_status_detail: String(order.status_detail || ""),
      p_paid_amount_cents: cents(order.total_paid_amount || payment.paid_amount || payment.amount),
      p_payment_reference: String(payment?.reference?.id || payment?.reference_id || payment?.id || ""),
      p_payment_method: String(payment?.payment_method?.type || payment?.payment_method?.id || ""),
      p_raw: order,
    });
    if (confirmError) throw confirmError;

    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false }, { status: 500 });
  }
});
