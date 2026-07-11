// app/login/page.tsx
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      router.push(searchParams.get('from') || '/admin');
      router.refresh();
    } else {
      setError(data.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm p-6 sm:p-8 bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-xl space-y-4"
    >
      <h1 className="text-2xl font-black uppercase tracking-widest text-center mb-2">Admin Login</h1>

      <input
        className="w-full px-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 outline-none focus:border-blue-500"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        className="w-full px-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 outline-none focus:border-blue-500"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        type="submit"
        className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold uppercase tracking-widest transition-all"
      >
        Login
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="h-screen w-full bg-[#05070d] text-white flex items-center justify-center">
      <Suspense fallback={<div className="text-white/40">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}