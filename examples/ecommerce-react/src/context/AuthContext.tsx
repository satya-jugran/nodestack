import React, { createContext, useContext, useEffect, useState } from 'react';
import { client } from '../lib/nodestack';
import { User } from '../lib/types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identity: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  demoLogin: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(
    (client.authStore.model as unknown as User) || null
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    // Sync React state with NodeStack AuthStore
    const unbind = client.authStore.onChange((token, model) => {
      setUser((model as unknown as User) || null);
    });

    return () => {
      unbind();
    };
  }, []);

  const login = async (identity: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await client.collection('users').authWithPassword(identity, password);
      setUser(res.record as unknown as User);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, password: string, name: string) => {
    setIsLoading(true);
    try {
      // 1. Create record in users auth collection
      await client.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        name,
      });

      // 2. Immediately authenticate
      const res = await client.collection('users').authWithPassword(email, password);
      setUser(res.record as unknown as User);
    } finally {
      setIsLoading(false);
    }
  };

  const demoLogin = async () => {
    setIsLoading(true);
    const demoEmail = 'alex.vance@nodestack.dev';
    const demoPass = 'DemoPassword123!';
    const demoName = 'Alex Vance';

    try {
      // Try login first
      try {
        const res = await client.collection('users').authWithPassword(demoEmail, demoPass);
        setUser(res.record as unknown as User);
        return;
      } catch (err) {
        // If user doesn't exist, register then login
        await client.collection('users').create({
          email: demoEmail,
          password: demoPass,
          passwordConfirm: demoPass,
          name: demoName,
        });

        const res = await client.collection('users').authWithPassword(demoEmail, demoPass);
        setUser(res.record as unknown as User);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    client.authStore.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user && client.authStore.isValid,
        isLoading,
        login,
        register,
        demoLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
