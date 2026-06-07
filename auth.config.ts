import type { NextAuthConfig } from 'next-auth'

// Edge-safe config — no Node.js-only imports (pg, Prisma).
// Used by middleware to verify JWT without touching the database.
export const authConfig: NextAuthConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        // token.sub is the standard JWT subject claim (always set by NextAuth).
        // token.id is our custom field set in the jwt callback above.
        // Fall back to token.sub in case token.id is absent on older sessions.
        (session.user as any).id = (token.id ?? token.sub) as string
        ;(session.user as any).role = token.role as string
      }
      return session
    },
  },
  providers: [],
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
  // SameSite=None; Secure is required so the browser forwards the session
  // cookie in cross-site fetch requests from the Chrome extension.
  // (chrome-extension:// is treated as a cross-site origin by the browser.)
  // The cookie stays httpOnly — JS cannot read it.
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'none',
        path: '/',
        secure: true,
      },
    },
  },
}
