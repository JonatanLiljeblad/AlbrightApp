import { createContext, useContext, type ReactNode } from 'react';

import type { AccessRequest } from './types';

export type AdminAccessContextValue = {
  email: string | null;
  owner: boolean;
  canAdmin: boolean;
  pendingRequests: AccessRequest[];
};

const AdminAccessContext = createContext<AdminAccessContextValue | null>(null);

export function AdminAccessProvider({
  value,
  children,
}: {
  value: AdminAccessContextValue;
  children: ReactNode;
}) {
  return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
}

export function useAdminAccess() {
  const value = useContext(AdminAccessContext);
  if (!value) {
    throw new Error('useAdminAccess must be used within AdminAccessProvider');
  }
  return value;
}
