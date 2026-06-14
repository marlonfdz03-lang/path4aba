import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Path4ABA — AI-Powered Clinical Documentation for ABA Professionals",
  description:
    "Generate session notes, manage clients, and track fieldwork hours. Built for RBTs, BCBAs and ABA Students. HIPAA compliant. Start free for 7 days.",
  keywords:
    "ABA therapy software, RBT session notes, BCBA documentation, fieldwork tracker, ABA student hours, BACB compliant",
};

// ── Shared ────────────────────────────────────────────────────────────────────

function Check() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block" }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar() {
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #E2E8F0",
      }}
    >
      <div
        style={{
          maxWidth: 1152,
          margin: "0 auto",
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <img src="/logo.png" alt="Path4ABA" style={{ width: 36, height: 36, objectFit: "contain" }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: "#0A1628" }}>
            Path<span style={{ color: "#2563EB" }}>4</span>ABA
          </span>
        </a>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="/login"
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid #E2E8F0",
              color: "#4A5568",
              textDecoration: "none",
            }}
          >
            Sign In
          </a>
          <a
            href="/pricing"
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              background: "linear-gradient(135deg, #0F62FE, #1B5BE8)",
              color: "white",
              textDecoration: "none",
            }}
          >
            Start Free Trial
          </a>
        </div>
      </div>
    </nav>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      style={{
        background: "linear-gradient(135deg, #040D21 0%, #071A52 50%, #0F3496 100%)",
        padding: "88px 24px 108px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative glow circles */}
      <div style={{ position: "absolute", width: 600, height: 600, borderRadius: "50%", background: "rgba(37,99,235,0.18)", filter: "blur(100px)", top: -200, right: -200, pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "rgba(96,165,250,0.12)", filter: "blur(80px)", bottom: -100, left: -100, pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "rgba(15,98,254,0.15)", filter: "blur(60px)", top: "40%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />

      <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 99,
            marginBottom: 32,
            fontSize: 12,
            fontWeight: 600,
            background: "rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.8)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          🔒 HIPAA Compliant
        </div>

        <h1
          style={{
            fontSize: "clamp(40px, 7vw, 64px)",
            fontWeight: 800,
            lineHeight: 1.1,
            color: "white",
            marginBottom: 24,
          }}
        >
          Smarter Documentation.
          <br />
          <span style={{ color: "#60A5FA" }}>Better Outcomes.</span>
        </h1>

        <p
          style={{
            fontSize: 17,
            lineHeight: 1.7,
            color: "rgba(255,255,255,0.7)",
            maxWidth: 560,
            margin: "0 auto 40px",
          }}
        >
          AI-powered clinical documentation for RBTs, BCBAs and ABA Students.
          Generate session notes in seconds, manage clients, and stay HIPAA compliant.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginBottom: 48,
          }}
        >
          <a
            href="/pricing"
            style={{
              padding: "14px 32px",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              background: "linear-gradient(135deg, #0F62FE, #1B5BE8)",
              color: "white",
              textDecoration: "none",
              boxShadow: "0 8px 24px rgba(15,98,254,0.4)",
            }}
          >
            Start Free Trial — 7 days free
          </a>
          <a
            href="/login"
            style={{
              padding: "14px 32px",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              background: "rgba(255,255,255,0.1)",
              color: "white",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.25)",
            }}
          >
            Sign In
          </a>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          {["100+ Notes Generated", "HIPAA Compliant", "Built for ABA"].map((s) => (
            <span
              key={s}
              style={{
                padding: "6px 16px",
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 500,
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.65)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Who It's For ──────────────────────────────────────────────────────────────

function WhoItsFor() {
  const cards = [
    {
      emoji: "🧑‍⚕️",
      title: "For RBTs",
      description:
        "Generate AI session notes in seconds. Manage up to 2 clients. Connect with your BCBA supervisor.",
      price: "Plans from $14.99/mo",
      features: [
        "AI session note generation",
        "Up to 2 client profiles",
        "BCBA supervisor connection",
        "Schedule tracker",
      ],
    },
    {
      emoji: "👩‍💼",
      title: "For BCBAs",
      description:
        "Supervision notes, progress reports, and client management. Oversee your RBT team efficiently.",
      price: "Plans from $29.99/mo",
      features: [
        "Supervision & progress reports",
        "Unlimited client management",
        "Multi-RBT oversight",
        "Clinical profile tools",
      ],
    },
    {
      emoji: "🎓",
      title: "For ABA Students",
      description:
        "Track fieldwork hours, stay BACB compliant, and generate 200+ supervision notes.",
      price: "From $14.99/mo (add-on) or $19.99/mo standalone",
      features: [
        "BACB-compliant hour tracking",
        "200+ supervision notes",
        "Monthly M-FVF PDF export",
        "Progress dashboards",
      ],
    },
  ];

  return (
    <section style={{ background: "white", padding: "80px 24px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 700,
              color: "#2563EB",
              marginBottom: 12,
            }}
          >
            Who It&apos;s For
          </p>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "#0A1628" }}>
            Built for every role in ABA
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 24,
          }}
        >
          {cards.map((card) => (
            <div
              key={card.title}
              style={{
                borderRadius: 20,
                padding: "28px 28px 32px",
                border: "1px solid #E2E8F0",
                boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 16 }}>{card.emoji}</div>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: "#0A1628", marginBottom: 10 }}>
                {card.title}
              </h3>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "#718096", marginBottom: 20 }}>
                {card.description}
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "0 0 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  flex: 1,
                }}
              >
                {card.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 13,
                      color: "#4A5568",
                    }}
                  >
                    <span style={{ color: "#2563EB", marginTop: 1, flexShrink: 0 }}>
                      <Check />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#2563EB" }}>{card.price}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

function Features() {
  const features: Array<{ icon: string; title: string; desc: string; badge?: string; href?: string }> = [
    { icon: "✨", title: "AI Session Notes", desc: "Generate clinical-quality notes that pass insurance audits" },
    { icon: "👥", title: "Client Management", desc: "Upload assessments, track behaviors and skills" },
    { icon: "🔗", title: "Chrome Extension", desc: "Generate notes directly from Office Puzzle", href: "https://chromewebstore.google.com/detail/imignknofjahdlgopbfkpopcdnffchgk" },
    { icon: "📊", title: "Progress Reports", desc: "AI-powered progress reports with behavior trend analysis" },
    { icon: "📋", title: "Fieldwork Tracker", desc: "BACB-compliant hour tracking for ABA students" },
    { icon: "🔒", title: "HIPAA Compliant", desc: "All data encrypted and stored securely on Azure" },
  ];

  return (
    <section style={{ background: "#071A52", padding: "80px 24px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 700,
              color: "#60A5FA",
              marginBottom: 12,
            }}
          >
            Features
          </p>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "white" }}>
            Everything you need in one place
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
          }}
        >
          {features.map((f) => {
            const cardStyle: React.CSSProperties = {
              borderRadius: 16,
              padding: "24px 24px 28px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              position: "relative",
              display: "block",
              textDecoration: "none",
            };
            const inner = (
              <>
                {f.badge && (
                  <span
                    style={{
                      position: "absolute",
                      top: 16,
                      right: 16,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "3px 10px",
                      borderRadius: 99,
                      background: "rgba(96,165,250,0.18)",
                      color: "#60A5FA",
                    }}
                  >
                    {f.badge}
                  </span>
                )}
                <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "white", marginBottom: 8 }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.55)" }}>
                  {f.desc}
                </p>
              </>
            );
            return f.href ? (
              <a key={f.title} href={f.href} target="_blank" rel="noopener noreferrer" style={cardStyle}>
                {inner}
              </a>
            ) : (
              <div key={f.title} style={cardStyle}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Pricing Teaser ────────────────────────────────────────────────────────────

function PricingTeaser() {
  const plans: Array<{
    name: string;
    price: string;
    per: string;
    desc: string;
    features: string[];
    highlighted: boolean;
    badge?: string;
  }> = [
    {
      name: "RBT — 1 Client",
      price: "$14.99",
      per: "mo",
      desc: "For RBTs with a single client",
      features: ["1 client profile", "Unlimited session notes", "AI note generation", "7-day free trial"],
      highlighted: false,
    },
    {
      name: "RBT — 2 Clients",
      price: "$19.99",
      per: "mo",
      desc: "For RBTs managing a small caseload",
      features: ["2 client profiles", "Unlimited session notes", "Note refinement", "7-day free trial"],
      highlighted: true,
      badge: "Most Popular",
    },
    {
      name: "BCBA Starter",
      price: "$29.99",
      per: "mo",
      desc: "For analysts supervising a growing team",
      features: ["Up to 15 client profiles", "BCBA dashboard", "Supervision tools", "7-day free trial"],
      highlighted: false,
    },
  ];

  return (
    <section style={{ background: "#F5F7FA", padding: "80px 24px" }}>
      <div style={{ maxWidth: 1024, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 700,
              color: "#2563EB",
              marginBottom: 12,
            }}
          >
            Pricing
          </p>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>
            Simple, transparent pricing
          </h2>
          <p style={{ fontSize: 15, color: "#718096" }}>
            Start free for 7 days — no credit card required
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
            marginBottom: 40,
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.name}
              style={{
                borderRadius: 20,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                position: "relative",
                background: plan.highlighted ? "#0A1628" : "white",
                border: plan.highlighted ? "none" : "1px solid #E2E8F0",
                boxShadow: plan.highlighted
                  ? "0 20px 60px rgba(10,22,40,0.22)"
                  : "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ height: 3, background: "linear-gradient(90deg, #2563EB, #60A5FA)" }} />
              {plan.badge && (
                <span
                  style={{
                    position: "absolute",
                    top: 20,
                    right: 20,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "4px 10px",
                    borderRadius: 99,
                    background: "rgba(96,165,250,0.18)",
                    color: "#60A5FA",
                  }}
                >
                  {plan.badge}
                </span>
              )}
              <div style={{ padding: "28px 28px 32px", flex: 1, display: "flex", flexDirection: "column" }}>
                <p
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontWeight: 700,
                    marginBottom: 6,
                    color: plan.highlighted ? "rgba(255,255,255,0.45)" : "#718096",
                  }}
                >
                  {plan.name}
                </p>
                <p style={{ fontSize: 13, marginBottom: 20, color: plan.highlighted ? "rgba(255,255,255,0.55)" : "#718096" }}>
                  {plan.desc}
                </p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 24 }}>
                  <span style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color: plan.highlighted ? "white" : "#0A1628" }}>
                    {plan.price}
                  </span>
                  <span style={{ fontSize: 13, marginBottom: 6, color: plan.highlighted ? "rgba(255,255,255,0.4)" : "#718096" }}>
                    /{plan.per}
                  </span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        fontSize: 13,
                        color: plan.highlighted ? "rgba(255,255,255,0.7)" : "#4A5568",
                      }}
                    >
                      <span style={{ color: "#2563EB", marginTop: 1, flexShrink: 0 }}>
                        <Check />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center" }}>
          <a
            href="/pricing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 28px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              border: "1.5px solid #2563EB",
              color: "#2563EB",
              textDecoration: "none",
            }}
          >
            See all plans →
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Testimonials ──────────────────────────────────────────────────────────────

function Testimonials() {
  const testimonials = [
    {
      quote:
        "Path4ABA has completely transformed how I write session notes. What used to take me 30 minutes now takes 2. The AI knows ABA terminology and the notes are always clinical quality.",
      author: "Jennifer Q.",
      role: "RBT",
      location: "South Florida",
    },
    {
      quote:
        "I love how easy it is to manage my clients and generate notes directly from Office Puzzle. Everything is in one place and it just works.",
      author: "Yuneisy M.",
      role: "RBT",
      location: "South Florida",
    },
    {
      quote:
        "The fieldwork tracker keeps me on top of my BACB hours. I always know exactly where I stand and what I need to complete my certification.",
      author: "Jennifer Q.",
      role: "BCBA Student",
      location: "South Florida",
    },
    {
      quote:
        "Path4ABA makes it easy to stay BACB compliant. The hour tracking and monthly summaries save me so much time every month.",
      author: "Pedro G.",
      role: "BCBA Student",
      location: "South Florida",
    },
    {
      quote:
        "Path4ABA keeps me organized and on track with my BACB requirements. The fieldwork tracker is incredibly easy to use and saves me time every week.",
      author: "Alberto C.",
      role: "BCBA Student",
      location: "South Florida",
    },
  ];

  return (
    <section style={{ background: "white", padding: "80px 24px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 700,
              color: "#2563EB",
              marginBottom: 12,
            }}
          >
            Testimonials
          </p>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "#0A1628" }}>
            Trusted by ABA professionals
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 24,
          }}
        >
          {testimonials.map((t, i) => (
            <div
              key={i}
              style={{
                borderRadius: 20,
                padding: 28,
                background: "linear-gradient(135deg, #EFF6FF 0%, #F0F7FF 100%)",
                border: "1px solid #DBEAFE",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: 36,
                  lineHeight: 1,
                  color: "#2563EB",
                  marginBottom: 12,
                  fontFamily: "Georgia, serif",
                }}
              >
                &ldquo;
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.75, color: "#4A5568", fontStyle: "italic", marginBottom: 20, flex: 1 }}>
                {t.quote}
              </p>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#0A1628" }}>
                  {t.author}
                </p>
                <p style={{ fontSize: 12, color: "#718096" }}>
                  {t.role} &middot; {t.location}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA Section ───────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <section
      style={{
        background: "linear-gradient(135deg, #0F62FE 0%, #071A52 100%)",
        padding: "80px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h2
          style={{
            fontSize: "clamp(28px, 5vw, 40px)",
            fontWeight: 800,
            color: "white",
            marginBottom: 12,
          }}
        >
          Ready to streamline your ABA practice?
        </h2>
        <p style={{ fontSize: 16, color: "rgba(255,255,255,0.7)", marginBottom: 40 }}>
          Join Path4ABA today — free for 7 days
        </p>
        <a
          href="/pricing"
          style={{
            display: "inline-block",
            padding: "14px 40px",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            background: "white",
            color: "#1B5BE8",
            textDecoration: "none",
          }}
        >
          Start Free Trial
        </a>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{ background: "#040D21", padding: "48px 24px" }}>
      <div style={{ maxWidth: 1152, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 32,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <img src="/logo.png" alt="Path4ABA" style={{ width: 32, height: 32, objectFit: "contain" }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: "white" }}>
                Path<span style={{ color: "#60A5FA" }}>4</span>ABA
              </span>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
              Clinical Intelligence for ABA Professionals
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
              © 2026 Marlon FM Services Corp · Sunrise, FL
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
            {[
              { label: "Privacy Policy", href: "/privacy" },
              { label: "Terms of Service", href: "/terms" },
              { label: "support@path4abaapp.com", href: "mailto:support@path4abaapp.com" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textDecoration: "none" }}
              >
                {link.label}
              </a>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: "5px 14px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              🔒 HIPAA Compliant
            </span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>HIPAA Compliant · Built in Florida 🌴</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <Hero />
      <WhoItsFor />
      <Features />
      <PricingTeaser />
      <Testimonials />
      <CTASection />
      <Footer />
    </>
  );
}
