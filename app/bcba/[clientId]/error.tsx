'use client'
export default function Error({ error }: { error: Error }) {
  return (
    <div style={{ padding: 40, color: 'red', background: 'white', minHeight: '100vh' }}>
      <h1>Error loading page</h1>
      <pre>{error?.message}</pre>
      <pre>{error?.stack}</pre>
    </div>
  )
}
