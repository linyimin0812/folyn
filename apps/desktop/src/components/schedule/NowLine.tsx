import { useState, useEffect, useRef } from 'react';
import { formatTime } from '@/schedule/markdown';

export function NowLine() {
  const ref = useRef<HTMLDivElement>(null);
  const [hState, setH] = useState(() => {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setH(now.getHours() + now.getMinutes() / 60);
    };
    const id = setInterval(tick, 10_000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div ref={ref} className="sw-now-line" style={{ top: `calc(${hState} * var(--hour-h))` }}>
      <span className="sw-now-label">{formatTime(hState)}</span>
    </div>
  );
}
