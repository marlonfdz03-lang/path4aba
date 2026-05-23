export default function GenerateNote() {
  return (
    <main className="min-h-screen bg-gray-50 text-black p-10">
      <div className="max-w-4xl mx-auto bg-white p-8 rounded-3xl shadow">
        <h1 className="text-4xl font-bold mb-4">Generate RBT Note</h1>

        <p className="text-gray-600 mb-8">
          Enter session information and create a professional ABA session note.
        </p>

        <div className="grid gap-4">
          <input className="border p-4 rounded-xl" placeholder="Client name" />
          <input className="border p-4 rounded-xl" placeholder="Place of service" />
          <input className="border p-4 rounded-xl" placeholder="Time in / Time out" />

          <textarea className="border p-4 rounded-xl h-28" placeholder="Behaviors observed today" />
          <textarea className="border p-4 rounded-xl h-28" placeholder="Interventions used" />
          <textarea className="border p-4 rounded-xl h-28" placeholder="Skills/programs worked on" />

          <button className="bg-black text-white py-4 rounded-xl text-lg">
            Generate Note
          </button>
        </div>
      </div>
    </main>
  );
}