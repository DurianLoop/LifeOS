#!/usr/bin/env python3
"""Billing provider abstraction for P2.

The repository can create a Stripe Checkout Session when production credentials
are supplied, but no secret keys or live prices are bundled. Entitlements are
still the authoritative product gate; billing providers only change plan state.
"""
from __future__ import annotations
from urllib import parse,request,error
import hashlib,hmac,json,os,time

class BillingError(RuntimeError):pass

def configured():return bool(os.getenv('LIFEOS_STRIPE_SECRET_KEY'))

def create_checkout(*,user_id,email,plan,success_url,cancel_url):
    if plan not in ('plus','pro'):raise BillingError('checkout plan must be plus or pro')
    key=os.getenv('LIFEOS_STRIPE_SECRET_KEY','');price=os.getenv('LIFEOS_STRIPE_PLUS_PRICE_ID' if plan=='plus' else 'LIFEOS_STRIPE_PRO_PRICE_ID','')
    if not (key and price):raise BillingError('Stripe billing is not configured')
    data=parse.urlencode({
      'mode':'subscription','line_items[0][price]':price,'line_items[0][quantity]':'1',
      'success_url':success_url,'cancel_url':cancel_url,'customer_email':email,
      'metadata[lifeos_user_id]':user_id,'metadata[lifeos_plan]':plan,
      'subscription_data[metadata][lifeos_user_id]':user_id,'subscription_data[metadata][lifeos_plan]':plan,
    }).encode()
    req=request.Request('https://api.stripe.com/v1/checkout/sessions',data=data,headers={'Authorization':'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded'},method='POST')
    try:
        with request.urlopen(req,timeout=30) as resp:r=json.loads(resp.read().decode());return {'provider':'stripe','checkout_session_id':r.get('id'),'url':r.get('url'),'plan':plan}
    except error.HTTPError as e:raise BillingError('Stripe HTTP '+str(e.code)+': '+e.read().decode(errors='replace')[:800])


def verify_stripe_webhook(raw_body:bytes,signature_header:str,secret:str|None=None,tolerance:int=300):
    """Verify a Stripe-style webhook signature without requiring the Stripe SDK.

    Returns the parsed event only after HMAC verification. Production deployments
    should keep LIFEOS_STRIPE_WEBHOOK_SECRET in their secret manager.
    """
    secret=secret or os.getenv('LIFEOS_STRIPE_WEBHOOK_SECRET','')
    if not secret: raise BillingError('Stripe webhook secret is not configured')
    parts={}
    for item in (signature_header or '').split(','):
        if '=' in item:
            k,v=item.split('=',1);parts.setdefault(k,[]).append(v)
    try: ts=int((parts.get('t') or ['0'])[0])
    except Exception: raise BillingError('invalid Stripe signature timestamp')
    if abs(int(time.time())-ts)>tolerance: raise BillingError('Stripe webhook timestamp outside tolerance')
    signed=str(ts).encode()+b'.'+raw_body
    expected=hmac.new(secret.encode(),signed,hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected,x) for x in parts.get('v1',[])):
        raise BillingError('invalid Stripe webhook signature')
    try: return json.loads(raw_body.decode())
    except Exception as e: raise BillingError('invalid Stripe webhook JSON') from e
