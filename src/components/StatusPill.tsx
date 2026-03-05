import { useEffect, useRef, useState, type ReactNode } from "react";

const FADE_OUT_MS = 200;

export default function StatusPill({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setExiting(false);
      setMounted(true);
    } else if (mounted) {
      setExiting(true);
      timerRef.current = setTimeout(() => {
        setMounted(false);
        setExiting(false);
      }, FADE_OUT_MS);
    }
  }, [visible]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!mounted) return null;

  return (
    <div className={`terminal-status-line${exiting ? " status-pill-out" : ""}`}>
      {children}
    </div>
  );
}
