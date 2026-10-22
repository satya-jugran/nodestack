export interface AppModel {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  isDefault: boolean;
  created: string;
  updated: string;
  stats?: {
    collectionsCount: number;
    recordsCount: number;
    storageSizeBytes: number;
    dbSizeBytes: number;
  };
}

export interface CreateAppDto {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  template?: 'ecommerce' | 'blog' | 'crm' | string;
}

export interface UpdateAppDto {
  name?: string;
  description?: string;
  icon?: string;
}
