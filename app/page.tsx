export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-100 text-black">

      <section className="flex flex-col items-center justify-center text-center px-6 py-32">

        <h1 className="text-7xl font-bold mb-6">
          Path4ABA
        </h1>

        <p className="text-2xl max-w-3xl text-gray-600 mb-10">
          Smart ABA documentation platform for RBTs, BCBAs, and ABA agencies.
          Generate professional session notes in seconds using AI-powered clinical workflows.
        </p>

        <div className="flex gap-4">
          <button className="bg-black text-white px-8 py-4 rounded-2xl text-lg hover:opacity-80">
            Start Free Trial
          </button>

          <button className="border border-black px-8 py-4 rounded-2xl text-lg hover:bg-black hover:text-white transition">
            Book Demo
          </button>
        </div>

      </section>

    </main>
  );
}