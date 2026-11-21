import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function cents(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405, headers: cors });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) throw new Error("unauthorized");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("unauthorized");
    const { data: ctx, error: ctxError } = await userClient.rpc("get_my_context");
    if (ctxError || !ctx) throw new Error("membership_not_found");

    const body = await req.json();
    const orderId = String(body.orderId || "");
    const accessKey = String(body.accessKey || "");
    if (!orderId || !accessKey) throw new Error("invalid_order");

    let { data: order, error: orderError } = await admin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("access_key", accessKey)
      .maybeSingle();
    if (orderError || !order) throw new Error("order_not_found");
    if (String(order.tenant_id) !== String(ctx.tenant_id)) throw new Error("forbidden");

    if (order.status === "pending_payment" && order.provider === "mercadopago" && order.provider_order_id) {
      const { data: conn } = await admin
        .from("payment_connections")
        .select("access_token,expires_at")
        .eq("tenant_id", order.tenant_id)
        .eq("status", "connected")
        .maybeSingle();

      if (conn?.access_token) {
        const mpRes = await fetch(
          "https://api.mercadopago.com/v1/orders/" + encodeURIComponent(String(order.provider_order_id)),
          { headers: { Authorization: "Bearer " + conn.access_token } },
        );
        if (mpRes.ok) {
          const mp = await mpRes.json();
          const payment = mp?.transactions?.payments?.[0] || {};
          const paid = cents(mp?.total_paid_amount || payment?.paid_amount || payment?.amount);
          const { error: confirmError } = await admin.rpc("service_confirm_point_order", {
            p_external_reference: String(mp.external_reference || order.id),
            p_provider_order_id: String(mp.id || order.provider_order_id),
            p_status: String(mp.status || "unknown"),
            p_status_detail: String(mp.status_detail || ""),
            p_paid_amount_cents: paid,
            p_payment_reference: String(payment?.reference?.id || payment?.reference_id || payment?.id || ""),
            p_payment_method: String(payment?.payment_method?.type || payment?.payment_method?.id || ""),
            p_raw: mp,
          });
          if (confirmError) throw confirmError;
          const refreshed = await admin.from("orders").select("*").eq("id", orderId).single();
          order = refreshed.data || order;
        }
      }
    }

    const { data: items } = await admin
      .from("order_items")
      .select("id,product_name,unit_price_cents,quantity,tickets_per_unit,created_at")
      .eq("order_id", orderId)
      .order("created_at");

    const { data: jobs } = await admin
      .from("print_jobs")
      .select("id,status,attempts,last_error,printed_at,ticket:tickets(id,code,sequence,printed_at,order_item:order_items(product_name))")
      .eq("order_id", orderId)
      .order("created_at");

    return Response.json({
      order: {
        id: order.id,
        status: order.status,
        total_cents: order.total_cents,
        provider: order.provider,
        provider_order_id: order.provider_order_id,
        terminal_id: order.terminal_id,
        payment_method: order.payment_method,
        print_status: order.print_status,
        paid_at: order.paid_at,
        completed_at: order.completed_at,
        last_error: order.last_error,
        is_demo: order.is_demo,
      },
      items: items || [],
      print_jobs: (jobs || []).map((j: any) => ({
        job_id: j.id,
        status: j.status,
        attempts: j.attempts,
        last_error: j.last_error,
        printed_at: j.printed_at,
        ticket_id: j.ticket?.id,
        ticket_code: j.ticket?.code,
        sequence: j.ticket?.sequence,
        product_name: j.ticket?.order_item?.product_name || "",
      })),
    }, { headers: cors });
  } catch (e) {
    const msg = String((e as any)?.message || e);
    const status = msg.includes("unauthorized") ? 401 : msg.includes("forbidden") ? 403 : 400;
    return Response.json({ error: msg }, { status, headers: cors });
  }
});
