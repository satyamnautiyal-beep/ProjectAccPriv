'use client';

import React from 'react';
import useUIStore from '../store/uiStore';
import styles from './Annotation.module.css';
import { Info } from 'lucide-react';

export default function Annotation({ title, what, why, how, children }) {
  const showAnnotations = useUIStore((state) => state.showAnnotations);

  if (!showAnnotations) {
    return <>{children}</>;
  }

  return (
    <div className={styles.annotationWrapper}>
      {children}
      <div className={styles.marker}>
        <Info size={14} />
      </div>
      <div className={styles.tooltip}>
        <div className={styles.title}>
          <Info size={16} />
          {title}
        </div>
        
        {what && (
          <div className={styles.section}>
            <span className={styles.label}>What</span>
            <span className={styles.text}>{what}</span>
          </div>
        )}
        
        {why && (
          <div className={styles.section}>
            <span className={styles.label}>Why</span>
            <span className={styles.text}>{why}</span>
          </div>
        )}
        
        {how && (
          <div className={styles.section}>
            <span className={styles.label}>How</span>
            <span className={styles.text}>{how}</span>
          </div>
        )}
      </div>
    </div>
  );
}
