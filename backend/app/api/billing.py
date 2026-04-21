"""
Stripe webhook handler.

Listens for subscription events and updates user plan in DB.

Events handled:
  - checkout.session.completed  → User paid, activate Pro
  - customer.subscription.deleted → Subscription cancelled, downgrade to Free
  - invoice.payment_failed       → Payment failed, send warning email
"""

from fastapi import APIRouter, Request, HTTPException, Header
import stripe
from app.core.config import settings

router = APIRouter()
stripe.api_key = settings.STRIPE_SECRET_KEY


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, stripe_signature: str = Header(None)):
    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        customer_id = data.get("customer")
        user_id = data.get("client_reference_id")  # Set this when creating checkout
        # TODO: Update user plan to "pro" in DB
        print(f"✅ User {user_id} upgraded to Pro (Stripe customer: {customer_id})")

    elif event_type == "customer.subscription.deleted":
        customer_id = data.get("customer")
        # TODO: Downgrade user to free plan in DB
        print(f"⬇️ Subscription cancelled for customer {customer_id}")

    elif event_type == "invoice.payment_failed":
        customer_id = data.get("customer")
        # TODO: Send payment failed email
        print(f"❌ Payment failed for customer {customer_id}")

    return {"received": True}


@router.post("/checkout/create-session")
async def create_checkout_session(body: dict):
    """
    Creates a Stripe Checkout session for Pro plan.
    Returns the URL to redirect the user to.
    """
    user_id = body.get("user_id")  # From Clerk JWT in production

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
            "price": settings.STRIPE_PRO_PRICE_ID,
            "quantity": 1,
        }],
        mode="subscription",
        client_reference_id=user_id,
        success_url=f"https://yourdomain.com/app?upgraded=true",
        cancel_url=f"https://yourdomain.com/pricing",
    )

    return {"url": session.url}
