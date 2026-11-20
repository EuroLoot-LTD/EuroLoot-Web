import {first,run,json,requireValue,HttpError,limitedText} from './policy.mjs';
const encoder=new TextEncoder();
export async function stripeCheckout(env,order,origin) {
  requireValue(/^sk_test_/.test(env.STRIPE_TEST_KEY||'') && env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),503,'Stripe test checkout is not configured.');
  const data=new URLSearchParams({mode:'payment','payment_method_types[0]':'card',client_reference_id:order.id,'metadata[order_id]':order.id,'payment_intent_data[metadata][order_id]':order.id,
    'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'eur','line_items[0][price_data][unit_amount]':String(order.total),
    'line_items[0][price_data][product_data][name]':'EuroLoot sandbox order','billing_address_collection':'required',
    success_url:origin+'/retail/#orders',cancel_url:origin+'/retail/#basket'});
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{Authorization:'Bearer '+env.STRIPE_TEST_KEY,'Idempotency-Key':'el-'+order.id},body:data});
  if(!response.ok)throw new HttpError(503,'Test checkout is unavailable. Retry this order.');
  const session=await response.json();
  requireValue(session.livemode===false && new URL(session.url).origin==='https://checkout.stripe.com',502,'Unexpected test checkout response.');
  return session.url;
}
export async function webhook(request,env) {
  requireValue(env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') && /^sk_test_/.test(env.STRIPE_TEST_KEY||''),503,'Test payments are disabled.');
  const raw=await limitedText(request,131072);
  const parts=(request.headers.get('stripe-signature')||'').split(',').map(p=>p.split('='));
  const stamp=parts.find(p=>p[0]==='t')?.[1]||'';
  requireValue(/^\d{10}$/.test(stamp) && Math.abs(Date.now()/1000-Number(stamp))<=300,400,'Invalid signature timestamp.');
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;
  for(const [type,hex] of parts.slice(0,12)){
    if(type==='v1' && /^[0-9a-f]{64}$/.test(hex))valid ||= await crypto.subtle.verify('HMAC',key,Uint8Array.from(hex.match(/../g),v=>parseInt(v,16)),encoder.encode(stamp+'.'+raw));
  }
  requireValue(valid,400,'Invalid webhook signature.');
  let event;try{event=JSON.parse(raw);}catch{throw new HttpError(400,'Invalid event.');}
  requireValue(event.livemode===false && event.data?.object,400,'Only test events are accepted.');
  const o=event.data.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(event.type)){
    const order=await first(env.DB,"SELECT * FROM orders WHERE id=? AND mode='stripe-test'",o.client_reference_id||'');
    if(!order)return json({received:true});
    requireValue(o.metadata?.order_id===order.id && o.currency==='eur' && o.amount_total===order.total,400,'Order mismatch.');
    if(event.type==='checkout.session.expired')await run(env.DB,"UPDATE orders SET state='expired' WHERE id=? AND state='pending'",order.id);
    else if(o.payment_status==='paid'){
      requireValue(o.customer_details?.address?.country===order.country && typeof o.payment_intent==='string',409,'Payment requires regional reconciliation.');
      await run(env.DB,"UPDATE orders SET state='complete',payment_ref=? WHERE id=? AND state='pending'",o.payment_intent,order.id);
    }
  }else if(event.type==='charge.refunded' && o.refunded===true && o.currency==='eur'){
    const ord=await first(env.DB,"SELECT * FROM orders WHERE payment_ref=? AND mode='stripe-test'",o.payment_intent||'');
    if(!ord)throw new HttpError(409,'Payment reference requires reconciliation.');
    requireValue(o.amount_refunded===ord.total,409,'Refund amount requires reconciliation.');
    await run(env.DB,"UPDATE orders SET state='refunded' WHERE id=? AND state='complete'",ord.id);
  }
  return json({received:true});
}
