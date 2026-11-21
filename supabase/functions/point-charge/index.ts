import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (ctx.role === "staff") throw new Error("forbidden");

    const body = await req.json();
    const orderId = String(body.orderId || "");
    const accessKey = String(body.accessKey || "");
    let terminalId = String(body.terminalId || "");
    if (!orderId || !accessKey) throw new Error("invalid_order");

    if (ctx.demo_mode) {
      const { data, error } = await userClient.rpc("demo_approve_pos_order", {
        p_order_id: orderId,
        p_access_key: accessKey,
      });
      if (error) throw error;
      return Response.json({ demo: true, status: data.status, printJobs: data.print_jobs }, { headers: cors });
    }

    if (!terminalId) {
      const { data: pref } = await admin
        .from("terminal_preferences")
        .select("terminal_id")
        .eq("tenant_id", ctx.tenant_id)
        .maybeSingle();
      terminalId = String(pref?.terminal_id || "");
    }
    if (!terminalId) throw new Error("terminal_not_selected");

    const { data: pctx, error: pctxError } = await admin.rpc("service_point_checkout_context", {
      p_order_id: orderId,
      p_access_key: accessKey,
    });
    if (pctxError) throw pctxError;
    if (String(pctx.tenant_id) !== String(ctx.tenant_id)) throw new Error("forbidden");

    if (pctx.expires_at && new Date(pctx.expires_at).getTime() <= Date.now() + 5 * 60 * 1000) {
      throw new Error("mercadopago_reconnect_required");
    }

    const mpBody = {
      type: "point",
      external_reference: String(pctx.order_id),
      expiration_time: "PT5M",
      transactions: {
        payments: [{ amount: (Number(pctx.total_cents) / 100).toFixed(2) }],
      },
      config: {
        point: { terminal_id: terminalId, print_on_terminal: "no_ticket" },
      },
      description: "Diversões Veneza - ingressos",
    };

    const mpRes = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + pctx.access_token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": String(pctx.payment_request_key),
      },
      body: JSON.stringify(mpBody),
    });
    const mp = await mpRes.json();
    if (!mpRes.ok) {
      const cause = mp?.errors?.[0]?.code || mp?.code || mp?.message || "mercadopago_error";
      throw new Error(String(cause));
    }

    const { error: markError } = await admin.rpc("service_mark_point_created", {
      p_order_id: orderId,
      p_provider_order_id: String(mp.id),
      p_terminal_id: terminalId,
      p_raw: mp,
    });
    if (markError) throw markError;

    return Response.json({
      demo: false,
      status: mp.status,
      providerOrderId: mp.id,
      terminalId,
    }, { headers: cors });
  } catch (e) {
    const msg = String((e as any)?.message || e);
    const friendly =
      msg.includes("already_queued_order_for_terminal")
        ? "A maquineta já possui uma cobrança pendente."
        : msg.includes("mp_not_connected")
          ? "Mercado Pago ainda não conectado."
          : msg.includes("mercadopago_reconnect_required")
            ? "Reconecte o Mercado Pago antes de iniciar a venda."
            : msg.includes("terminal_not_selected")
              ? "Selecione uma maquineta Point no painel."
              : msg;
    const status = msg.includes("unauthorized") ? 401 : msg.includes("forbidden") ? 403 : 400;
    return Response.json({ error: friendly }, { status, headers: cors });
  }
});
