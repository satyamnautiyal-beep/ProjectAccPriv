'use client';
import { useEffect } from 'react';

export default function RemoveBottomPadding() {
  useEffect(() => {
    const main = document.querySelector('main');
    if (main) {
      main.style.paddingBottom = '0px';
    }
    return () => {
      if (main) {
        main.style.paddingBottom = 'var(--space-6)';
      }
    };
  }, []);
  return null;
}
