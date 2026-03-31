import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [colorTheme, setColorTheme] = useState(localStorage.getItem('theme-color') || 'rose');
  const [mode, setMode] = useState(localStorage.getItem('theme-mode') || 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('theme-mode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('theme-color', colorTheme);
  }, [colorTheme]);

  return (
    <ThemeContext.Provider value={{ theme: colorTheme, setTheme: setColorTheme, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
