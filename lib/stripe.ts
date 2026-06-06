import Stripe from 'stripe'

let stripeInstance: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia',
    })
  }
  return stripeInstance
}

export type PlanKey = 'rbt_1' | 'rbt_2' | 'bcba_starter' | 'bcba_pro'

export const PLAN_LIMITS: Record<PlanKey | 'rbt' | 'trial', number> = {
  trial:        1,
  rbt:          1,  // legacy — same as rbt_1
  rbt_1:        1,
  rbt_2:        2,
  bcba_starter: 15,
  bcba_pro:     Infinity,
}

export const PRICES: Record<PlanKey, { month: string; year: string }> = {
  rbt_1: {
    month: process.env.STRIPE_PRICE_RBT_1_MONTHLY!,
    year:  process.env.STRIPE_PRICE_RBT_1_YEARLY!,
  },
  rbt_2: {
    month: process.env.STRIPE_PRICE_RBT_2_MONTHLY!,
    year:  process.env.STRIPE_PRICE_RBT_2_YEARLY!,
  },
  bcba_starter: {
    month: process.env.STRIPE_PRICE_BCBA_STARTER_MONTHLY!,
    year:  process.env.STRIPE_PRICE_BCBA_STARTER_YEARLY!,
  },
  bcba_pro: {
    month: process.env.STRIPE_PRICE_BCBA_PRO_MONTHLY!,
    year:  process.env.STRIPE_PRICE_BCBA_PRO_YEARLY!,
  },
}

// BCBA Students fieldwork tracker add-on
// addon (with active RBT plan): $14.99/mo · $149/yr
// standalone (no RBT plan):     $19.99/mo · $199/yr
export const BCBA_STUDENTS_PRICES = {
  addon: {
    month: process.env.STRIPE_PRICE_BCBA_STUDENTS_ADDON_MONTHLY!,
    year:  process.env.STRIPE_PRICE_BCBA_STUDENTS_ADDON_YEARLY!,
  },
  standalone: {
    month: process.env.STRIPE_PRICE_BCBA_STUDENTS_STANDALONE_MONTHLY!,
    year:  process.env.STRIPE_PRICE_BCBA_STUDENTS_STANDALONE_YEARLY!,
  },
}

export const ADDON_PRICES = {
  data_tool: {
    month: process.env.STRIPE_PRICE_DATA_TOOL_MONTHLY!,
    year:  process.env.STRIPE_PRICE_DATA_TOOL_YEARLY!,
  },
  assessment_tool: {
    month: process.env.STRIPE_PRICE_ASSESSMENT_TOOL_MONTHLY!,
    year:  process.env.STRIPE_PRICE_ASSESSMENT_TOOL_YEARLY!,
  },
}
