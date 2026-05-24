import Link from "next/link";

const h2: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: "#0D2B4E", marginTop: 48, marginBottom: 16 };
const h3: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: "#334155", marginTop: 28, marginBottom: 12 };
const p: React.CSSProperties = { fontSize: 15, lineHeight: "1.8", color: "#475569", marginBottom: 16, marginTop: 0 };
const ul: React.CSSProperties = { fontSize: 15, lineHeight: "1.8", color: "#475569", paddingLeft: 24, marginBottom: 16, marginTop: 0 };
const li: React.CSSProperties = { marginBottom: 6 };

export default function TermsPage() {
  return (
    <main style={{ fontFamily: "var(--font-dm-sans, sans-serif)", background: "white", minHeight: "100vh" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "60px 40px" }}>

        {/* Logo */}
        <Link href="/login" style={{ textDecoration: "none", display: "inline-block", marginBottom: 56 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#0D2B4E" }}>
            Path<span style={{ color: "#1BA8A0" }}>4</span>ABA
          </span>
        </Link>

        {/* Page title */}
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "#0D2B4E", marginBottom: 8, marginTop: 0 }}>Terms of Service</h1>
        <p style={{ fontSize: 14, color: "#94A3B8", marginBottom: 8, marginTop: 0 }}>
          <strong style={{ color: "#475569" }}>Path4ABA</strong> — Operated by Marlon FM Services Corp · Sunrise, Florida
        </p>
        <p style={{ fontSize: 14, color: "#94A3B8", marginBottom: 0, marginTop: 0 }}>
          Effective Date: May 24, 2026 &nbsp;·&nbsp; Last Updated: May 24, 2026
        </p>
        <hr style={{ margin: "40px 0", borderColor: "#E2E8F0", borderTop: "none" }} />

        {/* 1. Agreement */}
        <h2 style={h2}>1. Agreement to Terms</h2>
        <p style={p}>
          By accessing or using Path4ABA ("Platform"), operated by Marlon FM Services Corp ("Company," "we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the Platform.
        </p>
        <p style={p}>
          These Terms apply to all users including Registered Behavior Technicians (RBTs), Board Certified Behavior Analysts (BCBAs), Board Certified Assistant Behavior Analysts (BCaBAs), and any other individuals accessing the Platform.
        </p>

        {/* 2. Description */}
        <h2 style={h2}>2. Description of Service</h2>
        <p style={p}>Path4ABA is a clinical documentation and practice management platform for ABA professionals. The Platform provides:</p>
        <ul style={ul}>
          <li style={li}>AI-assisted session note generation</li>
          <li style={li}>Supervision note generation</li>
          <li style={li}>Client profile management</li>
          <li style={li}>Scheduling and attendance tracking</li>
          <li style={li}>BCBA-RBT supervision workflow tools</li>
          <li style={li}>Clinical data storage and management</li>
        </ul>

        {/* 3. Eligibility */}
        <h2 style={h2}>3. Eligibility</h2>
        <p style={p}>
          You must be at least 18 years of age and a licensed or credentialed ABA professional (or working under the supervision of one) to use the Platform. By using the Platform, you represent and warrant that you meet these requirements.
        </p>

        {/* 4. Account Registration */}
        <h2 style={h2}>4. Account Registration</h2>
        <p style={p}>To use the Platform, you must create an account. You agree to:</p>
        <ul style={ul}>
          <li style={li}>Provide accurate, current, and complete information</li>
          <li style={li}>Maintain and promptly update your account information</li>
          <li style={li}>Keep your password confidential</li>
          <li style={li}>Notify us immediately of any unauthorized access to your account</li>
          <li style={li}>Be responsible for all activity that occurs under your account</li>
        </ul>
        <p style={p}>You may not share your account with others or create accounts for third parties without authorization.</p>

        {/* 5. Subscription */}
        <h2 style={h2}>5. Subscription Plans and Billing</h2>

        <h3 style={h3}>5.1 Plans</h3>
        <p style={p}>The Platform is offered under the following subscription plans:</p>
        <ul style={ul}>
          <li style={li}><strong style={{ color: "#334155" }}>RBT Plan:</strong> Up to 3 client profiles</li>
          <li style={li}><strong style={{ color: "#334155" }}>BCBA/BCaBA Starter:</strong> Up to 15 client profiles</li>
          <li style={li}><strong style={{ color: "#334155" }}>BCBA/BCaBA Pro:</strong> Unlimited client profiles</li>
        </ul>

        <h3 style={h3}>5.2 Free Trial</h3>
        <p style={p}>
          New accounts receive a 7-day free trial with full access to all Platform features. A valid payment method is required to start the trial. You will not be charged until the trial period ends.
        </p>

        <h3 style={h3}>5.3 Billing</h3>
        <p style={p}>
          Subscriptions are billed monthly or annually in advance. By providing a payment method, you authorize us to charge the applicable subscription fee on a recurring basis until you cancel.
        </p>

        <h3 style={h3}>5.4 Price Changes</h3>
        <p style={p}>
          We reserve the right to change subscription prices with 30 days' notice. Continued use after the effective date constitutes acceptance of the new pricing.
        </p>

        <h3 style={h3}>5.5 Cancellation</h3>
        <p style={p}>
          You may cancel your subscription at any time through the Platform's billing settings. Upon cancellation, you retain access until the end of your current billing period. No refunds are provided for partial periods.
        </p>

        <h3 style={h3}>5.6 Refunds</h3>
        <p style={p}>
          All fees are non-refundable except as required by applicable law or at our sole discretion.
        </p>

        {/* 6. Promotional Codes */}
        <h2 style={h2}>6. Promotional Codes</h2>
        <p style={p}>
          Promotional codes (such as PATH5) provide discounts as specified at the time of issue. Promotional pricing applies only to the original subscription and is forfeited upon cancellation. Resubscribing after cancellation does not restore promotional pricing. Codes are non-transferable and may not be combined with other offers.
        </p>

        {/* 7. Acceptable Use */}
        <h2 style={h2}>7. Acceptable Use</h2>
        <p style={p}>You agree to use the Platform only for lawful purposes and in accordance with these Terms. You agree NOT to:</p>
        <ul style={ul}>
          <li style={li}>Use the Platform in violation of any applicable federal, state, or local law or regulation</li>
          <li style={li}>Submit false, inaccurate, or misleading clinical documentation</li>
          <li style={li}>Attempt to gain unauthorized access to any portion of the Platform</li>
          <li style={li}>Use the Platform to harm, threaten, or harass any person</li>
          <li style={li}>Transmit malware, viruses, or harmful code</li>
          <li style={li}>Scrape, crawl, or systematically extract data from the Platform</li>
          <li style={li}>Reverse engineer, decompile, or disassemble the Platform</li>
          <li style={li}>Use the Platform to compete with us or develop a competing product</li>
          <li style={li}>Share access credentials or allow unauthorized users to access your account</li>
        </ul>

        {/* 8. Clinical Documentation */}
        <h2 style={h2}>8. Clinical Documentation and Professional Responsibility</h2>

        <h3 style={h3}>8.1 AI-Generated Content</h3>
        <p style={p}>The Platform uses artificial intelligence to assist in generating clinical documentation. You acknowledge that:</p>
        <ul style={ul}>
          <li style={li}>AI-generated notes are tools to assist documentation, not replace professional judgment</li>
          <li style={li}>You are solely responsible for reviewing, editing, and approving all clinical documentation before submission</li>
          <li style={li}>AI-generated content may contain errors and must be verified by a qualified professional</li>
          <li style={li}>The Company makes no representations that AI-generated notes meet any specific payer, regulatory, or accreditation requirements</li>
        </ul>

        <h3 style={h3}>8.2 Professional Standards</h3>
        <p style={p}>You are solely responsible for ensuring that your use of the Platform complies with:</p>
        <ul style={ul}>
          <li style={li}>Your professional licensing requirements</li>
          <li style={li}>BACB Ethics Code and professional standards</li>
          <li style={li}>Applicable payer requirements (Medicaid, insurance, etc.)</li>
          <li style={li}>State and federal regulations governing ABA services</li>
          <li style={li}>HIPAA and applicable privacy laws</li>
        </ul>

        <h3 style={h3}>8.3 No Clinical Advice</h3>
        <p style={p}>
          The Platform does not provide clinical advice, diagnoses, or treatment recommendations. All clinical decisions are solely your professional responsibility.
        </p>

        {/* 9. HIPAA */}
        <h2 style={h2}>9. HIPAA and Protected Health Information</h2>
        <p style={p}>
          If you use the Platform to create, receive, maintain, or transmit Protected Health Information (PHI) as defined by HIPAA, you must execute a Business Associate Agreement (BAA) with us prior to such use. Contact privacy@path4aba.app to request a BAA.
        </p>
        <p style={p}>
          You represent and warrant that you have obtained all necessary patient/client authorizations and consents required by applicable law before entering any PHI into the Platform.
        </p>

        {/* 10. BCBA-RBT */}
        <h2 style={h2}>10. BCBA-RBT Supervision Features</h2>
        <p style={p}>The Platform's supervision features (client code sharing, supervision notes, RBT note review) are provided as documentation tools only. You acknowledge that:</p>
        <ul style={ul}>
          <li style={li}>The Platform does not verify professional credentials of any user</li>
          <li style={li}>BCBA supervisors are solely responsible for the quality and compliance of supervision activities</li>
          <li style={li}>Acceptance or rejection of RBT notes within the Platform does not constitute formal clinical approval for billing or regulatory purposes</li>
          <li style={li}>You must independently verify that your supervision practices comply with BACB requirements and applicable regulations</li>
        </ul>

        {/* 11. IP */}
        <h2 style={h2}>11. Intellectual Property</h2>

        <h3 style={h3}>11.1 Our Property</h3>
        <p style={p}>
          The Platform, including its software, design, text, graphics, and all other content (excluding user-submitted content), is owned by Marlon FM Services Corp and protected by copyright, trademark, and other intellectual property laws.
        </p>

        <h3 style={h3}>11.2 Your Content</h3>
        <p style={p}>
          You retain ownership of all clinical documentation and data you create using the Platform ("User Content"). By using the Platform, you grant us a limited license to store, process, and transmit your User Content solely to provide the services.
        </p>

        <h3 style={h3}>11.3 Feedback</h3>
        <p style={p}>
          If you provide suggestions or feedback about the Platform, we may use such feedback without obligation to you.
        </p>

        {/* 12. Privacy */}
        <h2 style={h2}>12. Privacy</h2>
        <p style={p}>
          Your use of the Platform is governed by our{" "}
          <Link href="/privacy" style={{ color: "#1BA8A0", textDecoration: "none" }}>Privacy Policy</Link>,
          which is incorporated into these Terms by reference.
        </p>

        {/* 13. Third-Party */}
        <h2 style={h2}>13. Third-Party Services</h2>
        <p style={p}>
          The Platform integrates with third-party services including OpenAI, Stripe, and Supabase. Your use of these services is subject to their respective terms and policies. We are not responsible for the practices of third-party services.
        </p>

        {/* 14. Disclaimers */}
        <h2 style={h2}>14. Disclaimers</h2>
        <p style={{ ...p, fontWeight: 600, color: "#334155" }}>
          THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
        </p>
        <p style={{ ...p, fontWeight: 600, color: "#334155" }}>WE DO NOT WARRANT THAT:</p>
        <ul style={{ ...ul, fontWeight: 600, color: "#334155" }}>
          <li style={li}>THE PLATFORM WILL BE UNINTERRUPTED OR ERROR-FREE</li>
          <li style={li}>AI-GENERATED CONTENT WILL BE ACCURATE OR COMPLETE</li>
          <li style={li}>THE PLATFORM WILL MEET YOUR SPECIFIC CLINICAL OR REGULATORY REQUIREMENTS</li>
          <li style={li}>DATA WILL NOT BE LOST OR CORRUPTED</li>
        </ul>

        {/* 15. Limitation of Liability */}
        <h2 style={h2}>15. Limitation of Liability</h2>
        <p style={{ ...p, fontWeight: 600, color: "#334155" }}>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, MARLON FM SERVICES CORP SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, DATA LOSS, OR DAMAGE TO GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE PLATFORM.
        </p>
        <p style={{ ...p, fontWeight: 600, color: "#334155" }}>
          OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF THESE TERMS OR YOUR USE OF THE PLATFORM SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM.
        </p>
        <p style={{ ...p, fontWeight: 600, color: "#334155" }}>
          SOME JURISDICTIONS DO NOT ALLOW LIMITATION OF LIABILITY FOR CERTAIN DAMAGES. IN SUCH JURISDICTIONS, OUR LIABILITY IS LIMITED TO THE MAXIMUM EXTENT PERMITTED BY LAW.
        </p>

        {/* 16. Indemnification */}
        <h2 style={h2}>16. Indemnification</h2>
        <p style={p}>
          You agree to indemnify, defend, and hold harmless Marlon FM Services Corp, its officers, directors, employees, and agents from any claims, liabilities, damages, losses, and expenses (including reasonable attorney's fees) arising out of or related to:
        </p>
        <ul style={ul}>
          <li style={li}>Your use of the Platform</li>
          <li style={li}>Your violation of these Terms</li>
          <li style={li}>Your violation of any third-party rights</li>
          <li style={li}>Any clinical documentation you create or submit</li>
          <li style={li}>Your violation of HIPAA or any other applicable law</li>
        </ul>

        {/* 17. Termination */}
        <h2 style={h2}>17. Termination</h2>
        <p style={p}>We reserve the right to suspend or terminate your account at any time for:</p>
        <ul style={ul}>
          <li style={li}>Violation of these Terms</li>
          <li style={li}>Non-payment of subscription fees</li>
          <li style={li}>Conduct that we determine, in our sole discretion, is harmful to other users, the Platform, or third parties</li>
        </ul>
        <p style={p}>
          Upon termination, your right to use the Platform immediately ceases. Provisions of these Terms that by their nature should survive termination will survive.
        </p>

        {/* 18. Governing Law */}
        <h2 style={h2}>18. Governing Law and Dispute Resolution</h2>
        <p style={p}>
          These Terms are governed by the laws of the State of Florida without regard to conflict of law principles. Any dispute arising from these Terms shall be resolved exclusively in the state or federal courts located in Broward County, Florida, and you consent to personal jurisdiction in such courts.
        </p>

        {/* 19. Changes */}
        <h2 style={h2}>19. Changes to Terms</h2>
        <p style={p}>
          We reserve the right to modify these Terms at any time. We will notify you of material changes by email or prominent notice on the Platform at least 30 days before they take effect. Continued use after the effective date constitutes acceptance of the updated Terms.
        </p>

        {/* 20. Entire Agreement */}
        <h2 style={h2}>20. Entire Agreement</h2>
        <p style={p}>
          These Terms, together with our Privacy Policy and any executed Business Associate Agreement, constitute the entire agreement between you and Marlon FM Services Corp regarding the Platform and supersede all prior agreements.
        </p>

        {/* 21. Contact */}
        <h2 style={h2}>21. Contact Us</h2>
        <p style={p}>For questions about these Terms:</p>
        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "24px 28px", border: "1px solid #E2E8F0" }}>
          <p style={{ ...p, marginBottom: 4, fontWeight: 600, color: "#0D2B4E" }}>Marlon FM Services Corp</p>
          <p style={{ ...p, marginBottom: 4 }}>d/b/a Path4ABA · Sunrise, Florida</p>
          <p style={{ ...p, marginBottom: 4 }}>
            Email:{" "}
            <a href="mailto:legal@path4abaapp.com" style={{ color: "#1BA8A0", textDecoration: "none" }}>
              legal@path4abaapp.com
            </a>
          </p>
          <p style={{ ...p, marginBottom: 0 }}>Website: path4aba.app</p>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 80, paddingTop: 24, borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 13, color: "#94A3B8", margin: 0 }}>
            © 2026 Marlon FM Services Corp. All rights reserved.
          </p>
          <div style={{ display: "flex", gap: 16 }}>
            <Link href="/privacy" style={{ fontSize: 13, color: "#1BA8A0", textDecoration: "none" }}>Privacy Policy</Link>
            <Link href="/terms" style={{ fontSize: 13, color: "#1BA8A0", textDecoration: "none" }}>Terms of Service</Link>
          </div>
        </div>

      </div>
    </main>
  );
}
