'use client';
import { useEffect } from 'react';

export default function LockBodyScroll() {
  useEffect(() => {
    // Force prevent user manual scrolling everywhere on html/body
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    // Position fixed prevents iOS Safari bounce
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    
    const main = document.querySelector('main');
    let originalMainOverflow = '';
    let originalMainPaddingBottom = '';
    
    if (main) {
      originalMainOverflow = main.style.overflow;
      originalMainPaddingBottom = main.style.paddingBottom;
      
      main.style.overflow = 'hidden';
      main.style.paddingBottom = '0px';
    }
    
    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      if (main) {
        main.style.overflow = originalMainOverflow;
        main.style.paddingBottom = originalMainPaddingBottom;
      }
    };
  }, []);
  return null;
}
