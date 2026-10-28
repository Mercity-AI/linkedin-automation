import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Logo } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, type User } from '@/lib/api';
import { keys } from '@/lib/queries';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: User }>('/auth/login', { email, password });
      qc.setQueryData(keys.me, user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-bg-subtle px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[380px]"
      >
        <div className="mb-8 flex items-center gap-3">
          <Logo className="size-[36px]" />
          <div className="leading-[1.2]">
            <div className="text-[17.5px] font-semibold tracking-[-0.015em]">Pulse</div>
            <div className="text-[12.5px] text-ink-3">Mercity</div>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in</h1>
        <p className="mt-1 text-sm text-ink-3">LinkedIn posts from the people your team follows.</p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@mercity.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              className="h-10"
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-10"
            />
          </Field>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] text-negative" role="alert">
              {error}
            </motion.p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-[13px] text-ink-3">No account? Ask an admin to add you from the Team page.</p>
      </motion.div>
    </div>
  );
}
