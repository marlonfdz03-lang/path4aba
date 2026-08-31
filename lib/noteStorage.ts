export interface StoredNote {
  id: string;
  clientId: string;
  date: string;
  note: string;
}

const NOTES_STORAGE_KEY = "path4aba_notes";

export function saveNote(note: StoredNote) {
  const existingNotes = getAllNotes();
  const updatedNotes = [...existingNotes, note];

  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(updatedNotes));
}

export function getAllNotes(): StoredNote[] {
  if (typeof window === "undefined") return [];

  const data = localStorage.getItem(NOTES_STORAGE_KEY);
  if (!data) return [];

  return JSON.parse(data);
}

export function getNotesByClientId(clientId: string): StoredNote[] {
  const notes = getAllNotes();

  return notes.filter((note) => note.clientId === clientId);
}

export function deleteNote(noteId: string) {
  const notes = getAllNotes();
  const updatedNotes = notes.filter((note) => note.id !== noteId);

  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(updatedNotes));
}

// Overwrite the text of one already-stored backup, in place. The autosave local backup is written once at
// generation, then kept CURRENT with every edit through this — so the device always holds the edited text, not
// just the generated text, and a server save lost inside the debounce window is never gone from both stores.
export function updateNote(noteId: string, note: string) {
  const notes = getAllNotes();
  const updatedNotes = notes.map((n) => (n.id === noteId ? { ...n, note } : n));

  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(updatedNotes));
}