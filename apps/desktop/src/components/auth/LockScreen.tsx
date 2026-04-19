import { useState, useCallback, useRef, useEffect } from 'react';

interface LockScreenProps {
  onUnlock: (token: string) => void;
  apiBase: string;
}

export function LockScreen({ onUnlock, apiBase }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiBase}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: password }),
      });

      if (response.ok) {
        onUnlock(password);
      } else {
        setError('密码错误，请重试');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
    }
  }, [password, apiBase, onUnlock]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="lock-screen">
      <div className="lock-card-glow" />
      <div className={`lock-card ${shake ? 'shake' : ''}`}>
        <div className="lock-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16.5" r="1.5" />
          </svg>
        </div>

        <div className="lock-brand">
          <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="28" height="28" style={{ borderRadius: 6 }} />
          <h2 className="lock-title">Quill</h2>
        </div>
        <p className="lock-subtitle">请输入访问密码以继续</p>

        <div className="lock-input-group">
          <input
            ref={inputRef}
            type="password"
            className="lock-input"
            placeholder="输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoComplete="current-password"
            autoCapitalize="off"
          />
          <button
            className="lock-btn"
            onClick={handleSubmit}
            disabled={loading || !password.trim()}
          >
            {loading ? (
              <span className="lock-spinner" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            )}
          </button>
        </div>

        {error && <p className="lock-error">{error}</p>}
      </div>
    </div>
  );
}
