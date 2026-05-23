import Stripe from 'stripe'

// Lazy singleton — only instantiated at request time, not module load.
let stripeInstance: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia',
    })
  }
  return stripeInstance
}

// Create these products/prices in your Stripe Dashboard and add the price IDs
// to .env.local and Vercel:
//   STRIPE_PRICE_RBT_MONTHLY, STRIPE_PRICE_RBT_YEARLY
//   STRIPE_PRICE_BCBA_MONTHLY, STRIPE_PRICE_BCBA_YEARLY
export const PRICES = {
  rbt: {
    month: process.env.STRIPE_PRICE_RBT_MONTHLY!,
    year: process.env.STRIPE_PRICE_RBT_YEARLY!,
  },
  bcba: {
    month: process.env.STRIPE_PRICE_BCBA_MONTHLY!,
    year: process.env.STRIPE_PRICE_BCBA_YEARLY!,
  },
} as const
