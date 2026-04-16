'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  UserCheck,
  MessageSquare,
  CheckCircle,
  Package,
  Activity,
  BarChart,
  Settings,
  Bot
} from 'lucide-react';
import useUIStore from '../../store/uiStore';
import styles from './Sidebar.module.css';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/file-intake', label: 'Subscriber Onboarding', icon: FileText },
  { href: '/integrity-workbench', label: 'Integrity Workbench', icon: UserCheck },
  { href: '/clarifications', label: 'Clarifications', icon: MessageSquare },
  { href: '/release-staging', label: 'Release Staging', icon: Package },
  { href: '/enrollment-monitoring', label: 'Enrollment Monitoring', icon: Activity },
  { href: '/insights', label: 'Insights', icon: BarChart },
  { href: '/ai-assistant', label: 'AI Assistant', icon: Bot },
];

export default function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  if (pathname === '/login') return null; // hide on login

  return (
    <aside className={`${styles.sidebar} ${sidebarOpen ? styles.open : styles.collapsed}`}>
      <div className={styles.logoContainer}>
        <div className={styles.logoMark}></div>
        {sidebarOpen && <span className={styles.logoText}>HealthEnroll</span>}
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <Icon size={20} className={styles.icon} />
              {sidebarOpen && <span className={styles.label}>{item.label}</span>}
              {isActive && sidebarOpen && <div className={styles.activeIndicator} />}
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <Link
          href="/admin"
          className={`${styles.navItem} ${pathname.startsWith('/admin') ? styles.active : ''}`}
        >
          <Settings size={20} className={styles.icon} />
          {sidebarOpen && <span className={styles.label}>Admin Settings</span>}
        </Link>
      </div>
    </aside>
  );
}
