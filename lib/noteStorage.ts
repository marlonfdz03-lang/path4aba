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