import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Contexte du serveur cible courant (Local OU un VPS revendeur enregistré).
// La valeur est persistée en localStorage sous `wg-selected-server` afin que
// l'intercepteur axios (hors React) puisse l'injecter dans l'en-tête
// `x-server-id` des appels /clients. 'local' (ou absent) = serveur historique.

export const SELECTED_SERVER_KEY = 'wg-selected-server';

const SelectedServerContext = createContext({
  selectedServerId: 'local',
  setSelectedServerId: () => {},
});

export const SelectedServerProvider = ({ children }) => {
  const [selectedServerId, setSelectedServerIdState] = useState(
    () => localStorage.getItem(SELECTED_SERVER_KEY) || 'local'
  );

  // Écrit immédiatement en localStorage : l'intercepteur axios lit cette clé de
  // façon synchrone à chaque requête (il n'a pas accès au state React).
  const setSelectedServerId = useCallback((id) => {
    const value = id || 'local';
    localStorage.setItem(SELECTED_SERVER_KEY, value);
    setSelectedServerIdState(value);
  }, []);

  // Garantit la cohérence localStorage ↔ state au montage (ex. valeur initiale).
  useEffect(() => {
    localStorage.setItem(SELECTED_SERVER_KEY, selectedServerId);
  }, [selectedServerId]);

  return (
    <SelectedServerContext.Provider value={{ selectedServerId, setSelectedServerId }}>
      {children}
    </SelectedServerContext.Provider>
  );
};

export const useSelectedServer = () => useContext(SelectedServerContext);

// Helper non-React pour l'intercepteur axios.
export const getSelectedServerId = () => localStorage.getItem(SELECTED_SERVER_KEY) || 'local';

export default SelectedServerContext;
