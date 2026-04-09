'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';
import Annotation from '../../components/Annotation';

export default function Login() {
  const router = useRouter();

  const handleLogin = (e) => {
    e.preventDefault();
    router.push('/dashboard');
  };

  return (
    <div className={styles.container}>
      <div className={styles.leftPanel}>
        <div className={styles.loginCard}>
          <div className={styles.logo}>
            <div className={styles.logoMark}></div>
            <div className={styles.logoText}>HealthEnroll</div>
          </div>
          
          <Annotation 
            title="Authentication Form"
            what="Clean, focused login interface without distractions."
            why="Enterprise applications require high security focus and clear data entry points."
            how="Using high contrast inputs and establishing trust through consistent brand styling."
          >
            <form onSubmit={handleLogin}>
              <h1 className={styles.cardTitle}>Welcome back</h1>
              <p className={styles.cardSubtitle}>Please enter your details to sign in.</p>
              
              <div className={styles.inputGroup}>
                <label className={styles.label}>Email Address</label>
                <input type="email" placeholder="name@company.com" className={styles.input} required />
              </div>
              
              <div className={styles.inputGroup}>
                <label className={styles.label}>Password</label>
                <input type="password" placeholder="••••••••" className={styles.input} required />
              </div>
              
              <div className={styles.options}>
                <label className={styles.checkboxContainer}>
                  <input type="checkbox" />
                  <span>Remember me for 30 days</span>
                </label>
                <Link href="#" className={styles.link}>Forgot password?</Link>
              </div>
              
              <button type="submit" className={styles.button}>Sign In</button>
            </form>
          </Annotation>
        </div>
      </div>
      
      <Annotation
        title="Split Screen Layout"
        what="50/50 split connecting the authentication functionality to the brand."
        why="Reinforces the value proposition and corporate identity for large healthcare networks."
        how="Utilizing a vibrant brand gradient with soft floating radial blobs to create depth."
      >
        <div className={styles.rightPanel}>
          <div className={styles.decorBlob}></div>
          <div className={styles.decorBlob2}></div>
          
          <div className={styles.heroContent}>
            <h2 className={styles.heroTitle}>Streamline your enrollment pipeline.</h2>
            <p className={styles.heroText}>
              The fastest, most secure way to process healthcare cases, manage renewals, and reconcile member data.
            </p>
          </div>
          
          <div className={styles.quote}>
            "HealthEnroll has transformed our intake process, saving our case workers 15 hours a week."
            <br/><br/>
            — Director of Admissions, National Health Corp
          </div>
        </div>
      </Annotation>
    </div>
  );
}
