'use client';

import React, { useState } from 'react';
import { Check, UploadCloud, File, AlertCircle, AlertTriangle, Zap } from 'lucide-react';
import styles from './intake.module.css';
import Annotation from '../../components/Annotation';

const steps = [
  { id: 1, label: 'Personal Info' },
  { id: 2, label: 'Eligibility' },
  { id: 3, label: 'Documents' },
  { id: 4, label: 'Review & Submit' }
];

export default function Intake() {
  const [activeTab, setActiveTab] = useState('manual');
  const [currentStep, setCurrentStep] = useState(1);
  const [ediFiles, setEdiFiles] = useState([
    { name: 'batch_medicare_0410.edi', status: 'success', time: '10:45 AM' },
    { name: 'batch_medicaid_0410.edi', status: 'processing', time: '10:50 AM' },
    { name: 'aca_enroll_invalid.edi', status: 'error', time: '10:52 AM' },
  ]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef(null);

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, steps.length));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFiles = (files) => {
    const validFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.edi'));
    
    if (validFiles.length === 0 && files.length > 0) {
      alert("Invalid file type. Only .edi files are accepted.");
      return;
    }

    const newFiles = validFiles.map((f) => ({
      name: f.name,
      status: 'processing',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawFile: f
    }));
    
    setEdiFiles((prev) => [...newFiles, ...prev]);

    newFiles.forEach(async (fileObj) => {
      const formData = new FormData();
      formData.append('file', fileObj.rawFile);
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          setEdiFiles((prev) => prev.map((pf) => 
            pf.name === fileObj.name ? { ...pf, status: 'success' } : pf
          ));
        } else {
          setEdiFiles((prev) => prev.map((pf) => 
            pf.name === fileObj.name ? { ...pf, status: 'error' } : pf
          ));
        }
      } catch (err) {
        setEdiFiles((prev) => prev.map((pf) => 
          pf.name === fileObj.name ? { ...pf, status: 'error' } : pf
        ));
      }
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  };

  const removeFile = (idxToRem) => {
    setEdiFiles((prev) => prev.filter((_, idx) => idx !== idxToRem));
  };

  const retryFile = (idxToRetry) => {
    setEdiFiles((prev) => prev.map((f, idx) => idx === idxToRetry ? { ...f, status: 'processing' } : f));
    // Simulate failing again since it usually failed for a reason
    setTimeout(() => {
      setEdiFiles((prev) => prev.map((f, idx) => idx === idxToRetry ? { ...f, status: 'error' } : f));
    }, 1500);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Member Enrollment</h1>
        
        <Annotation
          title="Dual Intake Flow Navigation"
          what="Tabs → separate intake methods → reduces confusion between manual and bulk flows"
          why="Prevents accidental mixing of high-volume processing with single-user data entry."
          how="A prominent tab strip sitting at the highest visual hierarchy within the page content area."
        >
          <div className={styles.tabsContainer}>
            <div 
              className={`${styles.tabBtn} ${activeTab === 'manual' ? styles.active : ''}`} 
              onClick={() => setActiveTab('manual')}
            >
              New Enrollment Intake
            </div>
            <div 
              className={`${styles.tabBtn} ${activeTab === 'edi' ? styles.active : ''}`} 
              onClick={() => setActiveTab('edi')}
            >
              EDI File Upload
            </div>
          </div>
        </Annotation>
      </header>

      <div className={styles.workspace}>
        {/* Left Column - Main Intake Method */}
        <div className={styles.mainArea}>
          {activeTab === 'manual' && (
            <>
              <Annotation
                title="Progressive Form Wizard"
                what="Stepper → simplifies complex form → improves completion rate"
                why="Large healthcare applications cause immediate cognitive fatigue. Chunking inputs retains user focus."
                how="Using numbered phases interconnected by progress lines."
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
                    title="Sectional Data Organization"
                    what="Form sections → organize input → reduce errors"
                    why="Grouping similar cognitive tasks (like addressing vs identity) lowers processing time and mistakes."
                    how="Implementing distinct sectional headers and structured CSS Grid combinations."
                  >
                    <div>
                      <div className={styles.sectionTitle}>Personal Details</div>
                      <div className={styles.row}>
                        <div className={styles.col}>
                          <div className={styles.inputGroup}>
                            <label className={`${styles.label} ${styles.required}`}>First Name</label>
                            <input type="text" className={styles.input} placeholder="e.g. John" />
                          </div>
                        </div>
                        <div className={styles.col}>
                          <div className={styles.inputGroup}>
                            <label className={`${styles.label} ${styles.required}`}>Last Name</label>
                            <input type="text" className={styles.input} placeholder="e.g. Doe" />
                          </div>
                        </div>
                      </div>
                      
                      <div className={styles.row}>
                        <div className={styles.col}>
                          <div className={styles.inputGroup}>
                            <label className={`${styles.label} ${styles.required}`}>Date of Birth</label>
                            <input type="date" className={styles.input} />
                          </div>
                        </div>
                        <div className={styles.col}>
                          <div className={styles.inputGroup}>
                            <label className={`${styles.label} ${styles.required}`}>Gender</label>
                            <select className={styles.input}>
                              <option>Male</option>
                              <option>Female</option>
                              <option>Other</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className={styles.sectionTitle} style={{marginTop: '24px'}}>Contact Info</div>
                      <div className={styles.row}>
                        <div className={styles.col}>
                          <div className={styles.inputGroup}>
                            <label className={styles.label}>Phone</label>
                            <input type="tel" className={styles.input} placeholder="(555) 000-0000" />
                          </div>
                        </div>
                        <div className={styles.col}>
                          <Annotation
                            title="Format Validation"
                            what="Validation → prevents incorrect uploads → reduces system errors"
                            why="Catches errors linearly before submission, avoiding back-and-forth form bouncing."
                            how="Highlighting the border red and providing inline error text explicitly linking to the field."
                          >
                            <div className={styles.inputGroup}>
                              <label className={`${styles.label} ${styles.required}`}>Email Address</label>
                              <input type="email" className={`${styles.input} ${styles.error}`} defaultValue="invalid-email-format" />
                              <span className={styles.errorMsg}>Please enter a valid email format.</span>
                            </div>
                          </Annotation>
                        </div>
                      </div>
                    </div>
                  </Annotation>
                )}

                {currentStep > 1 && (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    Step {currentStep} content rendered here...
                  </div>
                )}
              </div>

              <div className={styles.footer}>
                <button className={styles.btnSecondary} onClick={prevStep} disabled={currentStep === 1} style={{ opacity: currentStep === 1 ? 0.5 : 1 }}>
                  Back
                </button>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className={styles.btnSecondary}>Save Draft</button>
                  <button className={styles.btnPrimary} onClick={nextStep}>
                    {currentStep === steps.length ? 'Submit Application' : 'Next Step'}
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'edi' && (
            <div className={styles.formContent}>
              <Annotation
                title="Bulk Focus Strategy"
                what="EDI upload area → supports bulk enrollment → placed centrally for focus"
                why="EDI files are strictly formatted and batch process thousands of records. Distractions must be minimized."
                how="Drag-and-drop → improves usability → faster file upload combined with high contrast dotted borders."
              >
                <div 
                  className={styles.uploadArea}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ borderColor: isDragging ? 'var(--primary)' : 'var(--border-focus)', backgroundColor: isDragging ? 'var(--primary-light)' : 'var(--bg-root)' }}
                >
                  <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    onChange={handleFileInputChange} 
                    accept=".edi"
                  />
                  <UploadCloud size={48} className={styles.uploadIcon} />
                  <div className={styles.uploadTitle}>Upload .EDI files here</div>
                  <div className={styles.uploadSubtitle}>Drag and drop, or browse (Single or Multiple files supported)</div>
                </div>
              </Annotation>

              <Annotation
                title="File Event Tracking"
                what="File status → shows processing state → improves transparency"
                why="Large batches can take minutes. Case workers need explicit visual guarantees."
                how="Tabular layout distinguishing uploaded inputs, their timestamp, and color-coded status badges."
              >
                <div>
                  <h3 className={styles.fileListHeader}>Current Batch Queue</h3>
                  <table className={styles.fileTable}>
                    <thead>
                      <tr>
                        <th>File Name</th>
                        <th>Upload Time</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ediFiles.map((file, idx) => (
                        <tr key={idx}>
                          <td>
                            <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                              <File size={16} color="var(--text-muted)"/>
                              {file.name}
                            </div>
                          </td>
                          <td>{file.time}</td>
                          <td>
                            {file.status === 'success' && <span className={`${styles.fileStatus} ${styles.statusSuccess}`}><Check size={12}/> Success</span>}
                            {file.status === 'processing' && <span className={`${styles.fileStatus} ${styles.statusProcessing}`}><Zap size={12}/> Processing</span>}
                            {file.status === 'error' && <span className={`${styles.fileStatus} ${styles.statusError}`}><AlertTriangle size={12}/> Error</span>}
                          </td>
                          <td>
                            {file.status === 'error' && <button onClick={() => retryFile(idx)} style={{color:'var(--primary)', background:'none', border:'none', cursor:'pointer', fontSize:'0.85rem'}}>Retry Upload</button>}
                            {file.status !== 'error' && <button onClick={() => removeFile(idx)} style={{color:'var(--danger)', background:'none', border:'none', cursor:'pointer', fontSize:'0.85rem'}}>Remove</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Annotation>
            </div>
          )}
        </div>

        {/* Right Column - AI Panel */}
        <Annotation
          title="Persistent Operational Assistant"
          what="AI panel → assists user → reduces manual checking"
          why="Dual flow design → supports both digital and batch intake → improves scalability. A universal right panel guarantees immediate assistance regardless of workflow."
          how="Rendering explicitly alongside the workspace with 'Fix' and 'Review' direct action constraints."
        >
          <div className={styles.aiPanel}>
            <div className={styles.aiHeader}>
              <Zap size={18} color="var(--primary)" />
              AI Assistant
            </div>
            <div className={styles.aiContent}>
              
              {activeTab === 'manual' && (
                <>
                  <div className={styles.aiSuggestion}>
                    <div className={`${styles.suggestionHeader} ${styles.warning}`}>
                      <AlertTriangle size={16}/> Potential Duplicate Detected
                    </div>
                    <div className={styles.suggestionBody}>
                      The name "John Doe" with DOB 1990-01-01 matches existing active member MEM-8821.
                    </div>
                    <div className={styles.suggestionActions}>
                      <button className={styles.btnActionSm}>Review Existing</button>
                    </div>
                  </div>
                  
                  <div className={styles.aiSuggestion}>
                    <div className={`${styles.suggestionHeader} ${styles.error}`}>
                      <AlertCircle size={16}/> Missing Context
                    </div>
                    <div className={styles.suggestionBody}>
                      Eligibility documentation for Medicaid usually requires an income proof attachment before 'Step 3'.
                    </div>
                    <div className={styles.suggestionActions}>
                      <button className={styles.btnActionSm}>Add To Checklist</button>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'edi' && (
                <>
                  <div className={styles.aiSuggestion}>
                    <div className={`${styles.suggestionHeader} ${styles.error}`}>
                      <AlertCircle size={16}/> Invalid EDI Format
                    </div>
                    <div className={styles.suggestionBody}>
                      File <strong>aca_enroll_invalid.edi</strong> contains malformed segment loops on line 402. Loop 2000A missing required elements.
                    </div>
                    <div className={styles.suggestionActions}>
                      <button className={styles.btnActionSm}>Auto-Fix Format</button>
                      <button className={styles.btnActionSm}>View Log</button>
                    </div>
                  </div>
                  
                  <div className={styles.aiSuggestion}>
                    <div className={`${styles.suggestionHeader} ${styles.info}`}>
                      <Check size={16}/> Batch Profile Mapped
                    </div>
                    <div className={styles.suggestionBody}>
                      Identified 450 new enrollments in batch_medicare_0410.edi. Ready for database synchronization.
                    </div>
                    <div className={styles.suggestionActions}>
                      <button className={styles.btnActionSm} style={{borderColor:'var(--primary)', color:'var(--primary)'}}>Sync Batch</button>
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
