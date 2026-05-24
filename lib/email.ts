import { Resend } from 'resend'

const FROM = 'Path4ABA <hello@path4abaapp.com>'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('Missing RESEND_API_KEY environment variable')
  return new Resend(key)
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function btn(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;padding:13px 28px;background:#1BA8A0;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.1px;">${text}</a>`
}

function wrap(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;max-width:560px;width:100%;box-shadow:0 1px 4px rgba(0,0,0,0.07);">
      <tr>
        <td style="background:#0D2B4E;padding:24px 36px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:white;letter-spacing:-0.3px;">Path<span style="color:#1BA8A0">4</span>ABA</p>
        </td>
      </tr>
      <tr><td style="padding:36px 36px 28px;">${content}</td></tr>
      <tr>
        <td style="padding:20px 36px;background:#F8FAFC;border-top:1px solid #E2E8F0;">
          <p style="margin:0;font-size:12px;color:#94A3B8;line-height:1.7;">
            Path4ABA by Marlon FM Services Corp · Sunrise, Florida<br>
            <a href="https://path4aba.app/privacy" style="color:#1BA8A0;text-decoration:none;">Privacy Policy</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://path4aba.app/terms" style="color:#1BA8A0;text-decoration:none;">Terms of Service</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0D2B4E;line-height:1.3;">${text}</h1>`
}

function p(text: string, mb = 16): string {
  return `<p style="margin:0 0 ${mb}px;font-size:15px;line-height:1.75;color:#475569;">${text}</p>`
}

function divider(): string {
  return `<div style="height:1px;background:#E2E8F0;margin:24px 0;"></div>`
}

function featureRow(icon: string, label: string): string {
  return `<tr><td style="padding:5px 0;font-size:14px;color:#475569;">${icon}&nbsp;&nbsp;${label}</td></tr>`
}

// ── 1. Welcome / trial started ─────────────────────────────────────────────

export async function sendWelcomeEmail(to: string, name: string) {
  const html = wrap(`
    ${h1(`Welcome to Path4ABA, ${name}! 🎉`)}
    ${p('Your <strong style="color:#0D2B4E;">7-day free trial</strong> has started. You now have full access to every feature on the platform.', 24)}
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      ${featureRow('✅', 'AI-powered session note generation')}
      ${featureRow('✅', 'Client profile management')}
      ${featureRow('✅', 'Supervision note tools (BCBA)')}
      ${featureRow('✅', 'Schedule & attendance tracking')}
    </table>
    ${p('Get started by adding your first client:', 20)}
    ${btn('Open Path4ABA', 'https://path4aba.app/clients')}
    ${divider()}
    ${p('Questions? Reply to this email or contact us at <a href="mailto:hello@path4abaapp.com" style="color:#1BA8A0;text-decoration:none;">hello@path4abaapp.com</a>.', 0)}
  `)

  return getResend().emails.send({
    from: FROM,
    to,
    subject: 'Welcome to Path4ABA 🎉',
    html,
  })
}

// ── 2. Trial ending reminder ───────────────────────────────────────────────

export async function sendTrialEndingEmail(to: string, name: string, daysLeft: number) {
  const urgency = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
  const html = wrap(`
    ${h1(`Your trial ends ${urgency}, ${name}`)}
    ${p(`Your Path4ABA free trial expires in <strong style="color:#DC2626;">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>. Subscribe now to keep access to your clients, notes, and clinical data.`, 24)}
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">You'll lose access to:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      ${featureRow('❌', 'All client profiles and clinical data')}
      ${featureRow('❌', 'Session note generation')}
      ${featureRow('❌', 'Supervision workflow tools')}
    </table>
    ${p('Choose a plan and keep your momentum going:', 20)}
    ${btn('Subscribe Now', 'https://path4aba.app/pricing')}
    ${divider()}
    ${p('Questions or need help choosing a plan? Reply to this email — we\'re here to help.', 0)}
  `)

  return getResend().emails.send({
    from: FROM,
    to,
    subject: `Your Path4ABA trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
    html,
  })
}

// ── 3. Payment confirmation ────────────────────────────────────────────────

export async function sendPaymentConfirmationEmail(
  to: string,
  name: string,
  plan: string,
  amount: string
) {
  const planLabel = plan
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const html = wrap(`
    ${h1('Payment confirmed ✓')}
    ${p(`Thanks, ${name}. Your subscription to <strong style="color:#0D2B4E;">Path4ABA ${planLabel}</strong> is now active.`, 24)}
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 28px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:16px 20px;border-bottom:1px solid #E2E8F0;">
        <span style="font-size:13px;color:#64748B;">Plan</span><br>
        <span style="font-size:15px;font-weight:600;color:#0D2B4E;">${planLabel}</span>
      </td></tr>
      <tr><td style="padding:16px 20px;">
        <span style="font-size:13px;color:#64748B;">Amount</span><br>
        <span style="font-size:15px;font-weight:600;color:#0D2B4E;">${amount} / month</span>
      </td></tr>
    </table>
    ${btn('Go to Dashboard', 'https://path4aba.app/dashboard')}
    ${divider()}
    ${p('Manage your subscription at any time in <a href="https://path4aba.app/billing" style="color:#1BA8A0;text-decoration:none;">Billing Settings</a>. Need help? Contact us at <a href="mailto:hello@path4abaapp.com" style="color:#1BA8A0;text-decoration:none;">hello@path4abaapp.com</a>.', 0)}
  `)

  return getResend().emails.send({
    from: FROM,
    to,
    subject: `Payment confirmed — Welcome to Path4ABA ${planLabel}`,
    html,
  })
}

// ── 4. Payment failed ──────────────────────────────────────────────────────

export async function sendPaymentFailedEmail(to: string, name: string) {
  const html = wrap(`
    ${h1('Action required: payment failed')}
    ${p(`Hi ${name}, we weren't able to process your payment for Path4ABA. Your account access may be affected if this isn't resolved.`, 24)}
    <p style="margin:0 0 12px;font-size:15px;line-height:1.75;color:#475569;">Please update your payment method to continue using Path4ABA:</p>
    ${btn('Update Payment Method', 'https://path4aba.app/billing')}
    ${divider()}
    ${p('Common reasons for payment failure:', 8)}
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      ${featureRow('•', 'Expired or cancelled card')}
      ${featureRow('•', 'Insufficient funds')}
      ${featureRow('•', 'Bank declined the transaction')}
    </table>
    ${p('If you continue to have issues, contact us at <a href="mailto:hello@path4abaapp.com" style="color:#1BA8A0;text-decoration:none;">hello@path4abaapp.com</a> and we\'ll help you sort it out.', 0)}
  `)

  return getResend().emails.send({
    from: FROM,
    to,
    subject: 'Action required — Payment failed on Path4ABA',
    html,
  })
}

// ── 5. Password reset ──────────────────────────────────────────────────────

export async function sendPasswordResetEmail(to: string, resetLink: string) {
  const html = wrap(`
    ${h1('Reset your password')}
    ${p('We received a request to reset your Path4ABA password. Click the button below to set a new password:', 24)}
    ${btn('Reset Password', resetLink)}
    ${divider()}
    ${p('This link expires in <strong style="color:#0D2B4E;">1 hour</strong>. If you didn\'t request a password reset, you can safely ignore this email — your account is secure.', 0)}
  `)

  return getResend().emails.send({
    from: FROM,
    to,
    subject: 'Reset your Path4ABA password',
    html,
  })
}
