import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [colorTheme, setColorTheme] = useState(localStorage.getItem('theme-color') || 'indigo');
  
  // Logic: Check URL param first, then localStorage, then default to 'light'
  const getInitialMode = () => {
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get('theme');
    if (themeParam === 'light' || themeParam === 'dark') return themeParam;
    return localStorage.getItem('theme-mode') || 'light';
  };

  const [mode, setMode] = useState(getInitialMode());
  const isDark = mode === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('theme-mode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('theme-color', colorTheme);
  }, [colorTheme]);

  return (
    <ThemeContext.Provider value={{ theme: colorTheme, setTheme: setColorTheme, mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
