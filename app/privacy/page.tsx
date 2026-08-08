import Link from "next/link";

const h2: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: "#0D2B4E", marginTop: 48, marginBottom: 16 };
const h3: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: "#334155", marginTop: 28, marginBottom: 12 };
const p: React.CSSProperties = { fontSize: 15, lineHeight: "1.8", color: "#475569", marginBottom: 16, marginTop: 0 };
const ul: React.CSSProperties = { fontSize: 15, lineHeight: "1.8", color: "#475569", paddingLeft: 24, marginBottom: 16, marginTop: 0 };
const li: React.CSSProperties = { marginBottom: 6 };

export default function PrivacyPage() {
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
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "#0D2B4E", marginBottom: 8, marginTop: 0 }}>Privacy Policy</h1>
        <p style={{ fontSize: 14, color: "#94A3B8", marginBottom: 8, marginTop: 0 }}>
          <strong style={{ color: "#475569" }}>Path4ABA</strong> — Operated by Marlon FM Services Corp · Sunrise, Florida
        </p>
        <p style={{ fontSize: 14, color: "#94A3B8", marginBottom: 0, marginTop: 0 }}>
          Effective Date: May 24, 2026 &nbsp;·&nbsp; Last Updated: August 8, 2026
        </p>
        <hr style={{ margin: "40px 0", borderColor: "#E2E8F0", borderTop: "none" }} />

        {/* 1. Introduction */}
        <h2 style={h2}>1. Introduction</h2>
        <p style={p}>
          Marlon FM Services Corp ("Company," "we," "us," or "our") operates Path4ABA, a clinical intelligence platform accessible at path4aba.app and through the Path4ABA browser extension ("Platform"). This Privacy Policy explains how we collect, use, disclose, and safeguard information when you use our Platform.
        </p>
        <p style={p}>
          Please read this policy carefully. If you disagree with its terms, please discontinue use of the Platform.
        </p>

        {/* 2. Who We Are */}
        <h2 style={h2}>2. Who We Are and What We Do</h2>
        <p style={p}>
          Path4ABA is a software-as-a-service (SaaS) platform designed for Applied Behavior Analysis (ABA) professionals, including Registered Behavior Technicians (RBTs), Board Certified Behavior Analysts (BCBAs), and Board Certified Assistant Behavior Analysts (BCaBAs). The Platform provides tools for clinical documentation, session note generation, scheduling, and supervision management, along with an optional browser extension that helps users draft and enter clinical notes.
        </p>

        {/* 3. Information We Collect */}
        <h2 style={h2}>3. Information We Collect</h2>

        <h3 style={h3}>3.1 Account Information</h3>
        <p style={p}>When you create an account, we collect:</p>
        <ul style={ul}>
          <li style={li}>Full name</li>
          <li style={li}>Email address</li>
          <li style={li}>Professional role (RBT, BCBA, BCaBA)</li>
          <li style={li}>Password (encrypted)</li>
          <li style={li}>Billing information (processed by Stripe — we do not store payment card data)</li>
        </ul>

        <h3 style={h3}>3.2 Clinical Data</h3>
        <p style={p}>
          Users may upload assessment documents and enter clinical information related to their clients. We collect:
        </p>
        <ul style={ul}>
          <li style={li}>Behavioral assessment data (behaviors, behavior functions, interventions, replacement skills, activities)</li>
          <li style={li}>Session notes and supervision notes</li>
          <li style={li}>Scheduling and attendance records</li>
          <li style={li}>Clinical profiles and uploaded assessment files</li>
        </ul>
        <p style={{ ...p, padding: "12px 16px", background: "#FFF7ED", borderLeft: "3px solid #FB923C", borderRadius: "0 8px 8px 0" }}>
          <strong style={{ color: "#9A3412" }}>Important:</strong> We are designed to minimize the collection of Protected Health Information (PHI) as defined under HIPAA. Users are responsible for ensuring they do not enter unnecessary PHI into the Platform beyond what is required for clinical documentation purposes.
        </p>

        <h3 style={h3}>3.3 Automatically Collected Information</h3>
        <p style={p}>When you use the Platform, we automatically collect:</p>
        <ul style={ul}>
          <li style={li}>IP address</li>
          <li style={li}>Browser type and version</li>
          <li style={li}>Device information</li>
          <li style={li}>Pages visited and features used</li>
          <li style={li}>Time and date of access</li>
          <li style={li}>Referring URLs</li>
        </ul>

        <h3 style={h3}>3.4 Communications</h3>
        <p style={p}>If you contact us for support, we collect the content of your communications.</p>

        {/* 4. How We Use */}
        <h2 style={h2}>4. How We Use Your Information</h2>
        <p style={p}>We use collected information to:</p>
        <ul style={ul}>
          <li style={li}>Provide, operate, and maintain the Platform</li>
          <li style={li}>Generate AI-assisted clinical documentation using your session inputs</li>
          <li style={li}>Process payments and manage subscriptions</li>
          <li style={li}>Send transactional emails (account confirmation, billing receipts)</li>
          <li style={li}>Respond to customer support inquiries</li>
          <li style={li}>Monitor and analyze usage to improve the Platform</li>
          <li style={li}>Detect and prevent fraud or abuse</li>
          <li style={li}>Comply with legal obligations</li>
          <li style={li}>Enforce our Terms of Service</li>
        </ul>

        {/* 5. HIPAA */}
        <h2 style={h2}>5. HIPAA Compliance and Protected Health Information</h2>
        <p style={p}>
          Path4ABA is designed to support HIPAA-compliant workflows. As a Business Associate under HIPAA, Marlon FM Services Corp:
        </p>
        <ul style={ul}>
          <li style={li}>Implements administrative, physical, and technical safeguards to protect PHI</li>
          <li style={li}>Does not use or disclose PHI except as permitted by our Business Associate Agreement (BAA) and applicable law</li>
          <li style={li}>Maintains audit logs of access to clinical data</li>
          <li style={li}>Encrypts data at rest and in transit</li>
          <li style={li}>Processes and stores clinical data only within U.S.-based, BAA-covered infrastructure (see Section 8)</li>
        </ul>
        <p style={{ ...p, padding: "12px 16px", background: "#EFF6FF", borderLeft: "3px solid #3B82F6", borderRadius: "0 8px 8px 0" }}>
          <strong style={{ color: "#1E40AF" }}>If you are a Covered Entity under HIPAA, you must execute a Business Associate Agreement (BAA) with us before using the Platform to process PHI.</strong> Please contact us at privacy@path4aba.app to request a BAA.
        </p>
        <p style={p}>
          Users are solely responsible for obtaining appropriate patient/client authorizations and consents required under HIPAA and applicable state law before entering any PHI into the Platform.
        </p>

        {/* 6. AI-Generated Content */}
        <h2 style={h2}>6. AI-Generated Content</h2>
        <p style={p}>
          Path4ABA uses the Microsoft Azure OpenAI Service (GPT-4o model) to generate clinical documentation. When you submit session data to generate notes:
        </p>
        <ul style={ul}>
          <li style={li}>Session inputs are transmitted to the Azure OpenAI Service, which we operate within U.S. data regions</li>
          <li style={li}>This AI processing is covered by our Business Associate Agreement (BAA) with Microsoft Azure</li>
          <li style={li}>Azure OpenAI does <strong>not</strong> use your data to train or improve its models, and your prompts and outputs are not shared with the public OpenAI service or any other customer</li>
          <li style={li}>Generated notes are returned to you and stored in your account</li>
        </ul>
        <p style={p}>Users should not include unnecessary PHI in session inputs beyond what is required for note generation.</p>

        {/* 7. Path4ABA Browser Extension */}
        <h2 style={h2}>7. Path4ABA Browser Extension</h2>
        <p style={p}>
          The Path4ABA browser extension is an optional tool that lets you generate clinical notes and enter them directly into supported systems. When you use the extension:
        </p>
        <h3 style={h3}>7.1 Authentication Token</h3>
        <p style={p}>
          When you sign in through the extension, we store an authentication token in your browser's local extension storage. This token is used <strong>solely to authenticate your requests</strong> to the Path4ABA backend on your behalf. It is not used for tracking, advertising, or profiling, and it remains on your device until you sign out or remove the extension.
        </p>
        <h3 style={h3}>7.2 Clinical Note Content</h3>
        <p style={p}>
          When you ask the extension to generate or refine a note, the session inputs you provide (such as behaviors, behavior functions, interventions, and activities) are transmitted to the Path4ABA backend for AI-assisted note generation, exactly as described in Sections 6 and 8. This clinical data flows only to our BAA-covered backend — it is never sent to a third party that is not covered by our BAA, and it is never sold.
        </p>
        <h3 style={h3}>7.3 Electronic Health Record (EHR) Integrations</h3>
        <p style={p}>
          The extension can read from and fill forms on supported third-party clinical systems, including ABA Matrix (app.abamatrix.com) and OfficePuzzle (officepuzzle.com), to help you place completed notes and data into those systems. This activity is <strong>always user-initiated</strong>: the extension acts only when you invoke it on a page, and only to read the fields needed to draft a note or to write the values you have chosen to enter. We do not continuously monitor these sites in the background, and the content of those systems is governed by your own agreements with those providers.
        </p>
        <p style={p}>
          The extension requests only the browser permissions needed for these functions (access to our backend, the supported EHR sites, and the tab you are actively using). It does not collect your general browsing history.
        </p>

        {/* 8. Data Sharing */}
        <h2 style={h2}>8. Data Sharing and Disclosure</h2>
        <p style={p}>We do not sell your personal information. We may share information with the following service providers, each of which is bound by a data processing agreement and, where PHI is involved, a Business Associate Agreement:</p>
        <p style={{ ...p, marginBottom: 8 }}><strong style={{ color: "#334155" }}>Service Providers:</strong></p>
        <ul style={ul}>
          <li style={li}><strong>Microsoft Azure</strong> — cloud hosting, database (Azure Database for PostgreSQL), and AI processing (Azure OpenAI Service). All Path4ABA clinical data is hosted and processed in U.S. Azure regions under a Business Associate Agreement.</li>
          <li style={li}><strong>Stripe</strong> — payment processing. Stripe handles card data directly; we do not store payment card numbers.</li>
        </ul>
        <p style={p}>Each service provider is bound by data processing agreements and is prohibited from using your data for their own purposes.</p>
        <p style={p}>
          <strong style={{ color: "#334155" }}>Legal Requirements:</strong> We may disclose information if required by law, court order, or governmental authority, or to protect the rights, property, or safety of our Company, users, or the public.
        </p>
        <p style={p}>
          <strong style={{ color: "#334155" }}>Business Transfers:</strong> In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction. We will notify you via email and/or prominent notice on the Platform.
        </p>

        {/* 9. Data Retention */}
        <h2 style={h2}>9. Data Retention</h2>
        <p style={p}>We retain your information for as long as your account is active or as needed to provide services. Upon account termination:</p>
        <ul style={ul}>
          <li style={li}>Account data is deleted within 30 days</li>
          <li style={li}>Clinical documentation may be retained for up to 7 years as required by applicable healthcare regulations</li>
          <li style={li}>You may request earlier deletion subject to our legal retention obligations</li>
        </ul>
        <p style={p}>
          The authentication token stored by the browser extension is removed when you sign out of the extension or uninstall it. You may request deletion of your account and associated clinical data at any time by contacting privacy@path4aba.app.
        </p>

        {/* 10. Security */}
        <h2 style={h2}>10. Security</h2>
        <p style={p}>We implement industry-standard security measures including:</p>
        <ul style={ul}>
          <li style={li}>AES-256 encryption for data at rest</li>
          <li style={li}>TLS 1.2+ encryption for data in transit</li>
          <li style={li}>Role-based access controls</li>
          <li style={li}>Audit logging</li>
          <li style={li}>Regular security assessments</li>
        </ul>
        <p style={p}>No method of transmission over the internet is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.</p>

        {/* 11. Your Rights */}
        <h2 style={h2}>11. Your Rights</h2>
        <p style={p}>Depending on your jurisdiction, you may have the right to:</p>
        <ul style={ul}>
          <li style={li}>Access the personal information we hold about you</li>
          <li style={li}>Correct inaccurate information</li>
          <li style={li}>Request deletion of your information</li>
          <li style={li}>Object to or restrict processing</li>
          <li style={li}>Data portability</li>
          <li style={li}>Withdraw consent</li>
        </ul>
        <p style={p}>
          To exercise these rights, contact us at privacy@path4aba.app. We will respond within 30 days.
        </p>
        <p style={p}>
          <strong style={{ color: "#334155" }}>California Residents:</strong> You have additional rights under the California Consumer Privacy Act (CCPA), including the right to know, delete, and opt-out of the sale of personal information. We do not sell personal information.
        </p>
        <p style={p}>
          <strong style={{ color: "#334155" }}>Florida Residents:</strong> You have rights under the Florida Digital Bill of Rights applicable to certain controllers.
        </p>

        {/* 12. Cookies */}
        <h2 style={h2}>12. Cookies and Tracking</h2>
        <p style={p}>
          We use essential cookies necessary for Platform operation, including authentication session cookies. We do not use third-party advertising cookies or tracking pixels.
        </p>

        {/* 13. Children's Privacy */}
        <h2 style={h2}>13. Children&apos;s Privacy</h2>
        <p style={p}>
          The Platform is not directed to individuals under 18 years of age. We do not knowingly collect personal information from minors. If you believe a minor has provided us personal information, contact us immediately at privacy@path4aba.app.
        </p>

        {/* 14. Third-Party Links */}
        <h2 style={h2}>14. Third-Party Links</h2>
        <p style={p}>
          The Platform may contain links to third-party websites. We are not responsible for the privacy practices of those sites and encourage you to review their policies.
        </p>

        {/* 15. Changes */}
        <h2 style={h2}>15. Changes to This Policy</h2>
        <p style={p}>
          We may update this Privacy Policy from time to time. We will notify you of material changes by email or by posting a notice on the Platform at least 30 days before the changes take effect. Continued use of the Platform after the effective date constitutes acceptance of the updated policy.
        </p>

        {/* 16. Contact */}
        <h2 style={h2}>16. Contact Us</h2>
        <p style={p}>For privacy-related questions, requests, or to execute a Business Associate Agreement:</p>
        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "24px 28px", border: "1px solid #E2E8F0" }}>
          <p style={{ ...p, marginBottom: 4, fontWeight: 600, color: "#0D2B4E" }}>Marlon FM Services Corp</p>
          <p style={{ ...p, marginBottom: 4 }}>d/b/a Path4ABA · Sunrise, Florida</p>
          <p style={{ ...p, marginBottom: 4 }}>
            Email:{" "}
            <a href="mailto:privacy@path4aba.app" style={{ color: "#1BA8A0", textDecoration: "none" }}>
              privacy@path4aba.app
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
