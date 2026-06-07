import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './lib/generated/prisma/client'
import { authConfig } from './auth.config'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.users.findUnique({
          where: { email: credentials.email as string },
        })

        if (!user || !user.password) return null

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Re-fetch role from DB on every server-side auth() call so admin role
    // changes take effect immediately without the user needing to re-login.
    // Note: the middleware reads role from the JWT directly (edge-safe, no DB),
    // so middleware-gated routes will still see the old role until the JWT
    // expires or the user signs in again. Server-side checks are always fresh.
    async session({ session, token }) {
      if (token?.id) {
        ;(session.user as any).id = token.id as string
        try {
          const dbUser = await prisma.users.findUnique({
            where: { id: token.id as string },
            select: { role: true },
          })
          ;(session.user as any).role = dbUser?.role ?? (token.role as string)
        } catch {
          ;(session.user as any).role = token.role as string
        }
      }
      return session
    },
  },
})
