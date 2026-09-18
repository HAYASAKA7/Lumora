import { useEffect, useState } from 'react';

/** Whether the Lumora window has focus: a session in front of a window you left is not being watched. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    setFocused(document.hasFocus());
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return focused;
}
