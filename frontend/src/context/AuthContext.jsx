import { createContext, useEffect, useState } from "react";

import {
  fetchCurrentUser,
  loginUser,
  registerUser,
  setAuthToken,
} from "../api/authApi";

export const AuthContext = createContext(null);

const TOKEN_KEY = "ai-app-auth-token";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistSession = (nextToken, nextUser) => {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setAuthToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  };

  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);

      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        setAuthToken(storedToken);
        const { user: currentUser } = await fetchCurrentUser();
        setToken(storedToken);
        setUser(currentUser);
      } catch (error) {
        clearSession();
      } finally {
        setIsLoading(false);
      }
    };

    bootstrapAuth();
  }, []);

  const login = async (email, password) => {
    const response = await loginUser({ email, password });
    persistSession(response.token, response.user);
    return response.user;
  };

  const register = async (full_name, email, password) => {
    const response = await registerUser({ full_name, email, password });
    persistSession(response.token, response.user);
    return response.user;
  };

  const logout = () => {
    clearSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: Boolean(user && token),
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
