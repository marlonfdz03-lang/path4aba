export interface StoredClientProfile {
  id: string;
  clientName: string;
  clinicalProfile: {
    maladaptiveBehaviors: string[];
    interventions: string[];
    skillAcquisition: string[];
    replacementBehaviors: string[];
    reinforcers: string[];
  };
}

const STORAGE_KEY = "path4aba_clients";

export function saveClientProfile(profile: StoredClientProfile) {
  const existingClients = getClientProfiles();

  const updatedClients = [...existingClients, profile];

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(updatedClients)
  );
}

export function getClientProfiles(): StoredClientProfile[] {
  if (typeof window === "undefined") return [];

  const data = localStorage.getItem(STORAGE_KEY);

  if (!data) return [];

  return JSON.parse(data);
}

export function getClientById(id: string) {
  const clients = getClientProfiles();

  return clients.find((client) => client.id === id);
}
export function deleteClientProfile(clientId: string) {
  const clients = getClientProfiles();

  const updatedClients = clients.filter(
    (client) => client.id !== clientId
  );

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(updatedClients)
  );
}