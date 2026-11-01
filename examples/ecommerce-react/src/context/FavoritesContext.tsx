import React, { createContext, useContext, useEffect, useState } from 'react';
import { client } from '../lib/nodestack';
import { useAuth } from './AuthContext';
import { Product } from '../lib/types';

interface FavoritesContextType {
  favoriteProductIds: string[];
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (product: Product) => Promise<void>;
  favoriteCount: number;
  isLoading: boolean;
  isFavoritesModalOpen: boolean;
  setIsFavoritesModalOpen: (open: boolean) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

const LOCAL_FAVS_KEY = 'nodestack_guest_favorites';

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  // map productId -> favorite record id (for deletion in NodeStack)
  const [recordIdMap, setRecordIdMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);

  // Load favorites whenever auth changes
  useEffect(() => {
    let isMounted = true;

    async function loadFavorites() {
      if (isAuthenticated && user) {
        setIsLoading(true);
        try {
          const res = await client.collection('favorites').getList(1, 100, {
            filter: `user = "${user.id}"`,
          });
          if (isMounted) {
            const ids: string[] = [];
            const rMap: Record<string, string> = {};
            for (const fav of res.items) {
              ids.push(fav.product);
              rMap[fav.product] = fav.id;
            }

            // Merge guest favorites from localStorage into NodeStack backend
            try {
              const saved = localStorage.getItem(LOCAL_FAVS_KEY);
              if (saved) {
                const guestIds: string[] = JSON.parse(saved);
                const unmergedIds: string[] = [];
                for (const pId of guestIds) {
                  if (!ids.includes(pId)) {
                    try {
                      const created = await client.collection('favorites').create({
                        user: user.id,
                        product: pId,
                      });
                      ids.push(pId);
                      rMap[pId] = created.id;
                    } catch (createErr) {
                      console.warn('Failed to merge guest favorite to NodeStack:', createErr);
                      unmergedIds.push(pId);
                    }
                  }
                }
                if (unmergedIds.length === 0) {
                  localStorage.removeItem(LOCAL_FAVS_KEY);
                } else {
                  localStorage.setItem(LOCAL_FAVS_KEY, JSON.stringify(unmergedIds));
                }
              }
            } catch (mergeErr) {
              console.warn('Guest favorites merge note:', mergeErr);
            }

            setFavoriteProductIds(ids);
            setRecordIdMap(rMap);
          }
        } catch (err) {
          console.warn('Could not load favorites from backend, falling back to local', err);
          loadGuestFavorites();
        } finally {
          if (isMounted) setIsLoading(false);
        }
      } else {
        setRecordIdMap({});
        loadGuestFavorites();
      }
    }

    function loadGuestFavorites() {
      try {
        const saved = localStorage.getItem(LOCAL_FAVS_KEY);
        setFavoriteProductIds(saved ? JSON.parse(saved) : []);
        setRecordIdMap({});
      } catch {
        setFavoriteProductIds([]);
      }
    }

    loadFavorites();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user?.id]);

  const toggleFavorite = async (product: Product) => {
    const isFav = favoriteProductIds.includes(product.id);

    if (isAuthenticated && user) {
      if (isFav) {
        // Remove from DB
        let recordId = recordIdMap[product.id];
        setFavoriteProductIds((prev) => prev.filter((id) => id !== product.id));
        try {
          if (!recordId) {
            const existing = await client.collection('favorites').getList(1, 1, {
              filter: `user = "${user.id}" && product = "${product.id}"`,
            });
            if (existing.items.length > 0) {
              recordId = existing.items[0].id;
            }
          }
          if (recordId) {
            await client.collection('favorites').delete(recordId);
            setRecordIdMap((prev) => {
              const copy = { ...prev };
              delete copy[product.id];
              return copy;
            });
          }
        } catch (err) {
          console.error('Failed to remove favorite from NodeStack:', err);
        }
      } else {
        // Add to DB
        setFavoriteProductIds((prev) => [...prev, product.id]);
        try {
          const created = await client.collection('favorites').create({
            user: user.id,
            product: product.id,
          });
          setRecordIdMap((prev) => ({ ...prev, [product.id]: created.id }));
        } catch (err) {
          console.error('Failed to save favorite to NodeStack:', err);
        }
      }
    } else {
      // Local storage guest mode
      const updated = isFav
        ? favoriteProductIds.filter((id) => id !== product.id)
        : [...favoriteProductIds, product.id];
      setFavoriteProductIds(updated);
      try {
        localStorage.setItem(LOCAL_FAVS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const isFavorite = (productId: string) => favoriteProductIds.includes(productId);

  return (
    <FavoritesContext.Provider
      value={{
        favoriteProductIds,
        isFavorite,
        toggleFavorite,
        favoriteCount: favoriteProductIds.length,
        isLoading,
        isFavoritesModalOpen,
        setIsFavoritesModalOpen,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
};
