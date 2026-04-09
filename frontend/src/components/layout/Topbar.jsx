'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Search, Bell, HelpCircle, ToggleLeft, ToggleRight } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import styles from './Topbar.module.css';

export default function Topbar() {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar, showAnnotations, toggleAnnotations } = useUIStore();

  if (pathname === '/login') return null;

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button onClick={toggleSidebar} className={styles.iconButton} aria-label="Toggle Sidebar">
          <Menu size={20} />
        </button>
        <div className={styles.search}>
          <Search size={16} className={styles.searchIcon} />
          <input type="text" placeholder="Search members, cases, or tasks..." className={styles.searchInput} />
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.annotationToggle} onClick={toggleAnnotations}>
          <span className={styles.toggleLabel}>Annotations</span>
          {showAnnotations ? (
            <ToggleRight size={24} className={styles.toggleActive} />
          ) : (
            <ToggleLeft size={24} className={styles.toggleInactive} />
          )}
        </div>
        
        <div className={styles.divider}></div>
        
        <button className={styles.iconButton}>
          <HelpCircle size={20} />
        </button>
        <button className={styles.iconButton}>
          <div className={styles.badge}>3</div>
          <Bell size={20} />
        </button>
        
        <div className={styles.profile}>
          <div className={styles.avatar}>JD</div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>Jane Doe</span>
            <span className={styles.userRole}>Case Worker</span>
          </div>
        </div>
      </div>
    </header>
  );
}
