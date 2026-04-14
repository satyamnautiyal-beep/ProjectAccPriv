'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (res.ok) {
        router.push('/dashboard');
      } else {
        setError('Invalid credentials. Use admin@demo.com / admin123');
      }
    } catch(err) {
      setError('System error');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: 'var(--bg-root)', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, zIndex: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: '400px', margin: '0 auto' }}>
        <Annotation
          title="Login system"
          what="entry point"
          why="security"
          how="Validates system access against enterprise logic to gate AI system access."
        >
          <div className={styles.sectionCard} style={{ width: '100%', padding: 'var(--space-8)' }}>
          <h1 className={styles.title} style={{textAlign: 'center', marginBottom: 'var(--space-6)'}}>Healthcare Hub</h1>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {error && <div style={{ color: 'var(--danger)', backgroundColor: 'var(--danger-light)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', textAlign: 'center' }}>{error}</div>}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)' }}>Email</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@demo.com"
                style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text)' }}
                required
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)' }}>Password</label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="admin123"
                style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text)' }}
                required
              />
            </div>

            <button 
              type="submit" 
              className={styles.primaryButton}
              style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)' }}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Login'}
            </button>
            <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--space-4)' }}>Testing access: admin@demo.com / admin123</p>
          </form>
        </div>
      </Annotation>
      </div>
    </div>
  );
}
