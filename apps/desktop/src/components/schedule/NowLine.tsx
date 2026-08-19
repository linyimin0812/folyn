import { useState, useEffect } from 'react';

export function NowLine() {
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
    <div className="sw-now-line" style={{ top: `calc(${hState} * var(--hour-h))` }} />
  );
}
