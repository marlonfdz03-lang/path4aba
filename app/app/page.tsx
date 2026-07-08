import Image from "next/image";
import Link from "next/link";

/**
 * Welcome screen — the entry point of the mobile app (/app).
 */
export default function WelcomePage() {
  return (
    <main className="app-welcome">
      {/* Ambient corner glows for depth */}
      <div className="app-glow app-glow--tr" aria-hidden="true" />
      <div className="app-glow app-glow--bl" aria-hidden="true" />

      <div className="app-welcome__content">
        <Image
          src="/app-logo.png"
          alt="Path4ABA"
          width={110}
          height={110}
          priority
          className="app-welcome__logo"
        />

        <p className="app-welcome__eyebrow">Welcome to</p>
        <h1 className="app-welcome__title">Path4ABA</h1>
        <p className="app-welcome__tagline">
          Your daily assistant for notes, data, and signatures.
        </p>

        <div className="app-welcome__actions">
          <Link href="/app/login" className="app-btn app-btn--primary">
            Sign in
          </Link>
          <Link href="/app/role" className="app-btn app-btn--secondary">
            New here?
          </Link>
        </div>
      </div>
    </main>
  );
}
