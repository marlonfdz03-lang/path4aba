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

export type PlanKey = 'rbt' | 'bcba_starter' | 'bcba_pro'

// Max clients per plan. Enforcement happens client-side (clients stored in localStorage).
export const PLAN_LIMITS: Record<PlanKey | 'trial', number> = {
  trial: 3,
  rbt: 3,
  bcba_starter: 15,
  bcba_pro: Infinity,
}

export const PRICES: Record<PlanKey, { month: string; year: string }> = {
  rbt: {
    month: process.env.STRIPE_PRICE_RBT_MONTHLY!,
    year: process.env.STRIPE_PRICE_RBT_YEARLY!,
  },
  bcba_starter: {
    month: process.env.STRIPE_PRICE_BCBA_STARTER_MONTHLY!,
    year: process.env.STRIPE_PRICE_BCBA_STARTER_YEARLY!,
  },
  bcba_pro: {
    month: process.env.STRIPE_PRICE_BCBA_PRO_MONTHLY!,
    year: process.env.STRIPE_PRICE_BCBA_PRO_YEARLY!,
  },
}

// BCBA Students add-on pricing
// addon: $9.99/mo · $99/yr (for existing RBT subscribers)
// standalone: $14.99/mo · $149/yr (no existing plan)
export const BCBA_STUDENTS_PRICES = {
  addon: {
    month: process.env.STRIPE_PRICE_BCBA_STUDENTS_ADDON_MONTHLY!,
    year: process.env.STRIPE_PRICE_BCBA_STUDENTS_ADDON_YEARLY!,
  },
  standalone: {
    month: process.env.STRIPE_PRICE_BCBA_STUDENTS_STANDALONE_MONTHLY!,
    year: process.env.STRIPE_PRICE_BCBA_STUDENTS_STANDALONE_YEARLY!,
  },
}
