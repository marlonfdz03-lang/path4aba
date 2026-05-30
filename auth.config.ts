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
        (session.user as any).id = token.id as string
        ;(session.user as any).role = token.role as string
      }
      return session
    },
  },
  providers: [],
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
}
