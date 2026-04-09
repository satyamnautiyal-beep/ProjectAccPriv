'use client';

import React, { useState } from 'react';
import { Check } from 'lucide-react';
import styles from './intake.module.css';
import Annotation from '../../components/Annotation';

const steps = [
  { id: 1, label: 'Personal Info' },
  { id: 2, label: 'Plan Selection' },
  { id: 3, label: 'Dependents' },
  { id: 4, label: 'Review' }
];

export default function Intake() {
  const [currentStep, setCurrentStep] = useState(1);

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, steps.length));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  return (
    <div className={styles.container}>
      <div className={styles.formContainer}>
        <div className={styles.header}>
          <h1 className={styles.title}>New Enrollment Intake</h1>
          <p className={styles.subtitle}>Complete the form below to register a new member.</p>
        </div>

        <Annotation
          title="Progressive Disclosure Stepper"
          what="A wizard interface breaking a complex form into digestible steps."
          why="Long forms cause cognitive overload and high abandonment. Steppers show clear progression."
          how="Using localized state to manage the active view and highlighting completed steps with checkmarks."
        >
          <div className={styles.stepper}>
            {steps.map(step => {
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              
              return (
                <div key={step.id} className={`${styles.step} ${isActive ? styles.active : ''} ${isCompleted ? styles.completed : ''}`}>
                  <div className={styles.stepIndicator}>
                    {isCompleted ? <Check size={16} /> : step.id}
                  </div>
                  <span className={styles.stepLabel}>{step.label}</span>
                </div>
              );
            })}
          </div>
        </Annotation>

        <div className={styles.formContent}>
          {currentStep === 1 && (
            <Annotation
              title="Form Anatomy"
              what="Standardized input groupings with clear hierarchical labels."
              why="Ensures accessibility and rapid data entry for case workers."
              how="Using CSS Grid for structured multi-column layouts and distinct focus states for keyboard navigation."
            >
              <div>
                <div className={styles.row}>
                  <div className={styles.col}>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>First Name</label>
                      <input type="text" className={styles.input} placeholder="e.g. John" />
                    </div>
                  </div>
                  <div className={styles.col}>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Last Name</label>
                      <input type="text" className={styles.input} placeholder="e.g. Doe" />
                    </div>
                  </div>
                </div>
                
                <div className={styles.row}>
                  <div className={styles.col}>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Date of Birth</label>
                      <input type="date" className={styles.input} />
                    </div>
                  </div>
                  <div className={styles.col}>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Social Security Number</label>
                      <input type="password" className={styles.input} placeholder="XXX-XX-XXXX" />
                    </div>
                  </div>
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>Email Address</label>
                  <input type="email" className={styles.input} placeholder="name@example.com" />
                </div>
              </div>
            </Annotation>
          )}

          {currentStep > 1 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              Step {currentStep} content goes here...
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button 
            className={styles.btnBack} 
            onClick={prevStep}
            disabled={currentStep === 1}
            style={{ opacity: currentStep === 1 ? 0.5 : 1, cursor: currentStep === 1 ? 'not-allowed' : 'pointer' }}
          >
            Back
          </button>
          
          <button 
            className={styles.btnNext} 
            onClick={nextStep}
          >
            {currentStep === steps.length ? 'Submit Application' : 'Next Step'}
          </button>
        </div>
      </div>
    </div>
  );
}
