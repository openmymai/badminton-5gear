// lib/useIsAdmin.ts
'use client';

import { useEffect, useState } from 'react';

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.isAdmin))
      .catch(() => setIsAdmin(false))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setIsAdmin(false);
    window.location.href = '/'; // กลับหน้าแรก และ refresh state ทั้งหมด
  };

  return { isAdmin, loading, logout };
}