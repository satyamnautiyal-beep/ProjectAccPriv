# SEP Agent — Standard Operating Procedure & Business Rules

**Purpose:** This document defines the decision logic, eligibility rules, verification requirements, and edge case handling that govern the SEP (Special Enrollment Period) Eligibility Reasoner Agent. It is the authoritative source used to ground the agent's reasoning via RAG.

**Regulatory basis:** 42 CFR § 422.62 (Medicare Advantage enrollment), CMS CY2025 Enrollment & Disenrollment Guidance, CMS SEP Verification and Complex Case Scenarios guidance.

---

## Agent Mission

The SEP Agent receives a member enrollment request that falls outside a standard enrollment period (Annual Enrollment Period or Initial Enrollment Period). Its job is to:

1. Identify which SEP type applies based on the member's stated qualifying event.
2. Verify that the event occurred and that the member is within the valid enrollment window.
3. Assess the sufficiency of submitted evidence; flag what is missing.
4. Calculate the correct effective date.
5. Assign the correct SEP code for downstream CMS submission.
6. Escalate to a human compliance reviewer when the case cannot be resolved by rules alone.

**The agent must never approve an enrollment without a valid SEP determination. It must never deny without documenting the specific rule that disqualifies the case.**

---

## Part I — Enrollment Period Context

Before applying SEP rules, the agent must confirm the member does NOT already qualify for a standard enrollment period:

| Period | When | Who |
|---|---|---|
| Initial Enrollment Period (IEP) | 7-month window around Medicare Part A eligibility date (3 months before, month of, 3 months after) | First-time Medicare enrollees |
| Annual Enrollment Period (AEP) | Oct 15 – Dec 7 each year | All Medicare beneficiaries |
| Medicare Advantage Open Enrollment Period (MA OEP) | Jan 1 – Mar 31 each year | Current MA enrollees only |

**Rule:** If the member is within IEP or AEP, do NOT process as an SEP. Route to the standard enrollment flow.

---

## Part II — SEP Catalog

Each SEP entry defines: trigger event, who qualifies, enrollment window, effective date calculation, required evidence, denial triggers, and edge cases.

---

### SEP-01: Loss of Employer / Union Group Health Plan Coverage

**SEP Code:** Loss of GHP  
**Regulatory Ref:** 42 CFR § 422.62(b)(1)

**Trigger Event:** Member involuntarily loses employer-sponsored or union group health plan (GHP) coverage, OR voluntarily ends GHP upon retirement or resignation.

**Who Qualifies:**
- Was enrolled in GHP as primary coverage and delayed Medicare enrollment
- Coverage ended through no fault of member (layoff, employer closure, plan termination) OR through retirement/voluntary separation

**Enrollment Window:**
- Part A/B enrollment: 8 months starting the month after employment OR GHP coverage ends (whichever comes first)
- MA/Part D enrollment: 2 months after GHP coverage ends

**Effective Date:**
- Part A/B: Up to 3 months retroactive from enrollment month (if within 8-month window)
- MA/Part D: First day of the month following election

**Required Evidence (any one of the following):**
- Letter from employer confirming coverage end date
- HIPAA Certificate of Creditable Coverage showing termination date
- COBRA election notice (note: COBRA does NOT extend the SEP window — evidence only)
- Final paystub showing last date of benefit deductions
- Signed CMS-L564 (Request for Employment Information) completed by employer

**Denial Triggers:**
- Member is submitting more than 8 months after employment/coverage ended (Part A/B)
- Member is submitting more than 2 months after GHP ended (MA/Part D)
- Member had no GHP coverage (was on individual market or uninsured)
- Evidence shows coverage ended voluntarily mid-employment (not retirement/separation)

**Critical Edge Cases:**
- COBRA: Electing COBRA does NOT restart the SEP window. The 8-month window begins from when the original GHP coverage would have ended, not from when COBRA expires.
- Retiree coverage: If employer offers retiree health coverage post-retirement, SEP begins when retiree coverage ends, not at retirement date.
- Spouse/dependent: If member lost GHP as a dependent (e.g., divorce, spouse's death), this SEP still applies. Requires divorce decree or death certificate plus prior GHP evidence.
- ESRD exclusion: Beneficiaries with End-Stage Renal Disease (ESRD) cannot use this SEP for MA enrollment. Route ESRD cases to Original Medicare.

---

### SEP-02: Permanent Relocation / Move

**SEP Code:** Move / New Residency  
**Regulatory Ref:** 42 CFR § 422.62(b)(2)

**Trigger Event:** Member permanently moves to a new address that: (a) is outside their current MA plan's service area, OR (b) creates new plan options not previously available, OR (c) returns from abroad.

**Who Qualifies:**
- Current MA or Part D enrollee whose permanent address has changed
- Previously incarcerated person who is released (address change trigger — see also SEP-10)
- Person returning from abroad (was not eligible for MA while overseas)

**Enrollment Window:**
- Starts: the month BEFORE the move (if member notifies plan in advance)
- Ends: 2 full calendar months AFTER the month of the move
- Example: Move occurs June 15 → SEP window: June 1 – August 31

**Effective Date:**
- Member selects effective date up to 3 months after the month the enrollment request was submitted
- Earliest possible: First day of the month following the election

**Required Evidence (any one of the following):**
- Signed lease or mortgage deed at new address
- Driver's license or state-issued ID showing new address
- USPS change of address confirmation
- Utility bill (dated within 30 days) at new address
- School enrollment records
- Voter registration at new address

**Denial Triggers:**
- Move is temporary (vacation, seasonal, travel) — not a permanent change of residence
- Member is within same service area (no new plan options available)
- Move occurred more than 2 months prior to enrollment request with no prior notification to plan

**Critical Edge Cases:**
- Seasonal residency: Member who splits time between two states. SEP only applies if the new address constitutes the permanent primary residence.
- Service area boundary: Member moves 5 miles but stays within same plan service area → SEP does NOT apply unless new plan options are now available.
- Involuntary disenrollment risk: If member has been away from service area more than 6 months without notifying the plan, the plan may have already initiated involuntary disenrollment. Check plan records before processing.
- International return: Returning from abroad after extended absence. SEP window begins the month of return.
- Part D status: Relocation SEP cannot be used to change Part D enrollment status independently.

---

### SEP-03: Dual Eligible (Medicaid) SEP

**SEP Code:** Dual Eligible  
**Regulatory Ref:** 42 CFR § 422.62(b)(12)

**Trigger Event:** Member gains or loses any form of Medicaid eligibility, including full Medicaid, Medicare Savings Programs (MSP), or any state-sponsored Medicaid benefit.

**Who Qualifies:**
- Any Medicare beneficiary who currently holds OR just gained Medicaid entitlement
- Medicare beneficiaries who just LOST Medicaid (one-time use upon loss)

**Enrollment Window:**
- Upon GAINING Medicaid: Once per calendar month (ongoing, indefinite)
- Upon LOSING Medicaid: One-time use; SEP ends 2 months after the month Medicaid was lost

**Effective Date:** First day of the month following the election

**Required Evidence:**
- State Medicaid eligibility determination letter
- MSP approval notice (QMB, SLMB, QI, QDWI)
- Medicaid ID card (with current effective date)
- State Medicaid database verification (plan can query directly)

**Denial Triggers:**
- Member does not have and has not lost Medicaid (e.g., applied but was denied)
- Post-loss SEP window expired (more than 2 months after loss)
- Member attempting to use Dual SEP for MSA (Medical Savings Account) plans — prohibited

**Critical Edge Cases:**
- Partial Medicaid (MSP-only): Members with only a Medicare Savings Program (e.g., pays Part B premium only) DO qualify for this SEP — full Medicaid is not required.
- D-SNP restriction: This SEP is appropriate for enrollment into Dual Eligible Special Needs Plans (D-SNPs) and FIDE-SNPs. Members who want to enroll in an MSA plan cannot use this SEP.
- 2025 change: Effective January 1, 2025, CMS separated the dual/LIS SEP into two distinct monthly SEPs (one for dual eligibles, one for LIS/Extra Help). Treat these as separate SEP codes.
- Passive enrollment (Seamless Conversion): If member is passively enrolled in an MA plan via Medicaid managed care conversion, they have a 3-month opt-out window and an accompanying SEP to switch.

---

### SEP-04: Low-Income Subsidy (LIS) / Extra Help SEP

**SEP Code:** LIS / Extra Help  
**Regulatory Ref:** 42 CFR § 423.38(c)

**Trigger Event:** Social Security Administration (SSA) approves OR revokes the member's Part D Low-Income Subsidy (Extra Help).

**Who Qualifies:**
- Members SSA has determined eligible for Extra Help (full or partial)
- Members who just LOST Extra Help status

**Enrollment Window:**
- Upon GAINING Extra Help: Once per calendar month (ongoing)
- Upon LOSING Extra Help: SEP ends 2 months after the month of loss

**Effective Date:** First day of the month following the election

**Required Evidence:**
- SSA Extra Help determination letter (Form SSA-1020 approval or equivalent notice)
- CMS auto-enrollment notice (for those auto-assigned by CMS)
- SSA letter confirming LIS level (full subsidy vs partial subsidy)

**Denial Triggers:**
- Member applied for Extra Help but SSA has not yet issued a determination
- More than 2 months have passed since Extra Help was lost

**Critical Edge Cases:**
- Full vs Partial subsidy: Both full and partial Extra Help confer this SEP. Do not deny partial subsidy holders.
- 2025 change: Effective January 1, 2025, this is now a distinct monthly SEP allowing dually eligible/LIS individuals to switch from MA-PD to Original Medicare + standalone PDP. This is a NEW action type compared to prior years.
- Integrated care SEP (new 2025): Members may use the integrated care SEP to enroll once per month into a FIDE SNP, HIDE SNP, or applicable integrated plan (AIP). This is distinct from the standard LIS SEP.

---

### SEP-05: Institutionalization SEP

**SEP Code:** Institutionalized  
**Regulatory Ref:** 42 CFR § 422.62(b)(13)

**Trigger Event:** Member is admitted to, currently resides in, or is discharged from a qualifying long-term care facility.

**Qualifying Facilities:**
- Skilled Nursing Facilities (SNF)
- Psychiatric hospitals
- Rehabilitation hospitals
- Long-term care hospitals
- Swing bed arrangements

**Who Qualifies:** Any Medicare Part A and Part B enrollee admitted to or discharged from one of the above facilities.

**Enrollment Window:**
- Admission: SEP begins the month of admission and continues monthly during residence
- Discharge: SEP continues for 2 full calendar months after discharge
- Repeatable: Member may exercise this SEP once per month while institutionalized

**Effective Date:** First day of the month following the election

**Required Evidence:**
- Facility admission paperwork (signed)
- Discharge summary (for post-discharge elections)
- Letter from facility administrator confirming dates

**Denial Triggers:**
- Member is in a facility that does not meet the qualifying facility definition (e.g., assisted living without skilled nursing, adult day program)
- More than 2 months have passed since discharge

**Critical Edge Cases:**
- Assisted Living: Does NOT qualify. Member must be in a Medicare-certified SNF or other facility listed above.
- Institutional SNP (I-SNP): This SEP is the gateway for enrollment in I-SNPs. Members using this SEP may be eligible for I-SNP enrollment.
- Part D status: Institutionalization SEP cannot be used to independently change Part D enrollment status.
- Swing beds: Swing bed arrangements in rural hospitals qualify — do not deny these.

---

### SEP-06: Incarceration Release SEP

**SEP Code:** Released from Incarceration  
**Regulatory Ref:** 42 CFR § 407.23 (Part B SEP); CMS guidance effective Jan 1, 2025

**Trigger Event:** Member is released from a jail, prison, detention center, or other correctional/penal facility.

**Who Qualifies:**
- Individuals released from incarceration on or after January 1, 2025
- Must demonstrate Medicare eligibility was established (or could have been established) prior to or during incarceration
- Must demonstrate failure to enroll was due to confinement

**Enrollment Window:**
- Starts: Day of release
- Ends: Last day of the 12th month after the month of release
- Example: Released April 10, 2025 → SEP window through April 30, 2026

**Effective Date:** First day of the month following the election

**Required Evidence:**
- Official release/discharge papers from correctional facility (Form varies by state/federal system)
- For Part B: SSA conducts verification using available data — formal document submission to SSA required
- Medicare eligibility documentation (Medicare card, Social Security award letter)

**Denial Triggers:**
- Release occurred before January 1, 2025 (prior to effective date of this SEP)
- More than 12 months have passed since release
- Individual was never eligible for Medicare (e.g., too young, no qualifying work history)

**Critical Edge Cases:**
- Part A/B must be established first: Before enrolling in MA or Part D, member must first enroll in Medicare Part A and Part B. SEP agent must check Part A/B status and route to Part B SEP enrollment if needed.
- Federal vs. state facilities: Both qualify. Evidence format varies by system.
- Immigration detention: Not currently covered under this SEP per CMS guidance. Route to Exceptional Circumstances review.

---

### SEP-07: Disaster / Emergency SEP

**SEP Code:** Disaster or Emergency  
**Regulatory Ref:** CMS Administrative Authority

**Trigger Event:** A federal, state, or local government entity declares a disaster or emergency affecting the member's area.

**Who Qualifies:**
- Residents of the declared disaster/emergency area
- Non-residents who were unable to complete an enrollment election because they rely on friends or family in the affected area

**Enrollment Window:**
- Starts: Date of the government declaration OR the incident date (whichever CMS specifies)
- Ends: 2 full calendar months after the end date of the declared emergency

**Effective Date:** Per the member's election during the SEP window; determined case-by-case

**Required Evidence:**
- Official government declaration (FEMA, state emergency management, or local government)
- Proof of residence in or connection to affected area (utility bill, address on Medicare records, signed attestation)

**Denial Triggers:**
- No declared disaster/emergency covers the member's area
- Election made after the 2-month post-emergency window

**Critical Edge Cases:**
- Group determination: CMS may issue a group SEP covering all beneficiaries in a declared area. Check CMS bulletins first before requesting individual evidence.
- Non-residents: Must document connection to affected area (e.g., visiting family, caregiver for affected family member).

---

### SEP-08: 5-Star Plan SEP

**SEP Code:** 5-Star Plan  
**Regulatory Ref:** 42 CFR § 422.62(b)(14)

**Trigger Event:** A Medicare Advantage plan with a 5-star CMS quality rating is available in the member's service area.

**Who Qualifies:** Any current Medicare beneficiary (MA or Original Medicare) with access to a 5-star rated plan in their area.

**Enrollment Window:**
- December 8 through November 30 of the following year (annual cycle)
- One-time use per year

**Effective Date:** First day of the month following the election

**Required Evidence:** None — agent verifies 5-star plan availability via CMS Plan Finder data for the member's ZIP code.

**Denial Triggers:**
- No 5-star plan available in member's service area
- Member has already used this SEP during the current Dec 8–Nov 30 cycle

**Critical Edge Cases:**
- Part D coverage loss risk: If member switches from MA-PD to an MA-only plan using 5-star SEP, they may lose Part D coverage and be unable to separately join a PDP until AEP. Warn member and document consent.
- Late enrollment penalty: If gap in drug coverage results from this switch, member may incur Part D late enrollment penalty. Agent must flag this.

---

### SEP-09: Plan Contract Termination / Sanction SEP

**SEP Code:** Plan Contract Terminated  
**Regulatory Ref:** 42 CFR § 422.62(b)(6)

**Trigger Event:** Member's current MA or Part D plan: (a) has its CMS contract terminated or not renewed, (b) leaves the service area, (c) is placed under CMS sanction affecting enrollment, or (d) is taken over by state due to financial issues.

**Who Qualifies:** Current enrollees of the affected plan.

**Enrollment Window:**
- Starts: 2 months before the contract end date
- Ends: 1 month after the contract end date

**Effective Date:** First day of the month following the election; retroactive if needed to prevent coverage gap

**Required Evidence:** CMS notification letter or plan termination notice (CMS sends these directly; agent should verify via CMS data)

**Denial Triggers:** Member is not enrolled in the terminating/sanctioned plan

**Critical Edge Cases:**
- Auto-enrollment: CMS may auto-enroll affected members into a comparable plan. If member receives auto-enrollment notice and wants to select a different plan, they use this SEP.
- Coverage gap prevention: Agent should prioritize same-day processing to prevent gaps when contract end is imminent.

---

### SEP-10: Seamless Conversion / Passive Enrollment SEP

**SEP Code:** Seamless Conversion  
**Regulatory Ref:** 42 CFR § 422.62(b)(3)

**Trigger Event:** A Medicaid managed care enrollee becomes newly eligible for Medicare and is passively enrolled into an MA plan (typically a D-SNP) under the same parent organization as their Medicaid plan.

**Who Qualifies:** Medicaid managed care enrollees who newly become Medicare-eligible and whose Medicaid plan has a passive enrollment agreement with a co-located MA plan.

**Enrollment Window:**
- Advance notice: 60 days before passive enrollment effective date (member must opt out before effective date to prevent enrollment)
- Post-enrollment disenrollment SEP: 3 calendar months after passive enrollment effective date

**Effective Date:** The passive enrollment effective date (set by CMS/plan). After passive enrollment, any change is effective the first of the following month.

**Required Evidence:**
- 60-day advance notice received (for opt-out elections)
- Passive enrollment disenrollment request (for post-enrollment switches)

**Denial Triggers:**
- More than 3 months have passed since passive enrollment effective date without a change request
- Member was not subject to a passive enrollment agreement

---

### SEP-11: Federal / CMS Administrative Error SEP

**SEP Code:** Federal Error  
**Regulatory Ref:** CMS Administrative Authority

**Trigger Event:** A CMS or SSA employee error caused the member to be enrolled in the wrong plan, prevented intended enrollment, or caused an unintended disenrollment.

**Who Qualifies:** Members with documented evidence of a federal employee error.

**Enrollment Window:**
- Begins: The month CMS notifies the member that the SEP has been granted
- Ends: 2 months after CMS notification

**Effective Date:** First day of the month following the election

**Required Evidence:**
- CMS written determination letter granting this SEP
- Documentation of the federal error (CMS/SSA correspondence, call records)

**Denial Triggers:** CMS has not issued a determination granting this SEP. Agent cannot self-approve this SEP — must escalate to CMS/compliance team.

**Critical Edge Cases:** This SEP requires CMS approval; the agent's role is to compile the evidence package and route to the compliance escalation queue, not to make a final determination.

---

### SEP-12: Exceptional Circumstances SEP

**SEP Code:** Exceptional Circumstances  
**Regulatory Ref:** CMS Administrative Authority

**Trigger Event:** A circumstance that does not fall under any defined SEP category but that CMS determines constitutes an exceptional situation warranting relief.

**Who Qualifies:** Individuals or groups that CMS determines experienced exceptional circumstances (case-by-case or group determination).

**Enrollment Window:** Determined by CMS upon approval notification.

**Effective Date:** Prospective or retroactive, per CMS determination.

**Required Evidence:** Supporting documentation describing the circumstance; submitted to CMS for review.

**Denial Triggers:** CMS does not grant the SEP.

**Critical Edge Cases:**
- Broker/agent misinformation: If a broker or Medicare representative gave incorrect information that caused the member to miss an enrollment period, this SEP may apply. Document the misinformation with specificity (dates, what was said, who said it).
- Natural disaster (not declared): If a disaster occurred but was not formally declared, this may still qualify under Exceptional Circumstances at CMS's discretion.
- Agent role: Compile evidence package and route to CMS escalation queue. Do NOT self-approve.

---

### SEP-13: SPAP (State Pharmaceutical Assistance Program) SEP

**SEP Code:** SPAP  
**Regulatory Ref:** CMS guidance for participating states

**Trigger Event:** Member enrolls in or exits a qualifying State Pharmaceutical Assistance Program.

**Who Qualifies:** SPAP participants in states with CMS-recognized SPAP programs.

**Enrollment Window:** Once per calendar year.

**Effective Date:** First day of the month following the election.

**Required Evidence:** SPAP enrollment verification letter from the state program.

**Denial Triggers:**
- State does not have a CMS-recognized SPAP
- Member is not a current SPAP participant

---

### SEP-14: Trial Period SEP (First-Time MA Enrollment at Age 65)

**SEP Code:** Trial Period / First MA Enrollment  
**Regulatory Ref:** 42 CFR § 422.62(b)(4)

**Trigger Event:** Member enrolled in an MA plan for the first time when first becoming eligible for Medicare Part A at age 65, and wants to return to Original Medicare within 12 months.

**Who Qualifies:** Members in their first year of MA enrollment who initially enrolled at age 65.

**Enrollment Window:** Up to 12 months from the initial MA enrollment effective date.

**Effective Date:** First day of the month following the election.

**Required Evidence:**
- Confirmation that this is the member's first MA enrollment
- Current MA plan enrollment date
- Disenrollment request

**Special Rules:**
- Guaranteed issue Medigap rights: Member has guaranteed issue rights for Medigap within 63 days of disenrollment from the MA plan.
- Medigap plan options: If the member's prior Medigap policy is unavailable, they are limited to Plans A, B, D, G, K, or L.

**Denial Triggers:**
- More than 12 months have passed since initial MA enrollment
- Member has previously used a Trial Period SEP (one-time use at age 65)
- Member enrolled in MA before age 65 (disability-based Medicare)

---

## Part III — Agent Decision Tree

```
START
│
├─ Is member in IEP, AEP, or MA OEP? → YES → Route to Standard Enrollment Flow
│
└─ NO → Proceed with SEP determination
   │
   ├─ Member states a qualifying event
   │
   ├─ STEP 1: Map event to SEP type (catalog above)
   │   └─ If no match → Assess for Exceptional Circumstances (SEP-12)
   │
   ├─ STEP 2: Verify enrollment window
   │   ├─ Calculate: [today's date] vs. [event date + window days]
   │   └─ If outside window → DENY with specific reason; notify member of next enrollment opportunity
   │
   ├─ STEP 3: Check evidence sufficiency
   │   ├─ Match submitted documents against SEP's required evidence list
   │   ├─ If sufficient → Proceed
   │   └─ If insufficient → Identify exact missing items; trigger outreach to member/broker
   │
   ├─ STEP 4: Apply denial triggers
   │   └─ If any denial trigger is met → DENY with specific rule reference
   │
   ├─ STEP 5: Apply edge case rules
   │   └─ ESRD? Route to Original Medicare only
   │   └─ Federal Error or Exceptional Circumstances? Escalate to compliance team
   │
   ├─ STEP 6: Calculate effective date
   │   └─ Apply SEP-specific effective date rules (above)
   │
   └─ STEP 7: Assign SEP code → Submit to CMS enrollment system
```

---

## Part IV — Evidence Sufficiency Rules

### General Principles
1. **Original document preferred** over self-attestation. Attestation alone is only acceptable for MA plan elections when CMS regulations explicitly permit it (plans may request attestation but cannot require evidence for MA elections per 42 CFR).
2. **Timeliness:** Documents must confirm the triggering event occurred within the allowable SEP window.
3. **Identity match:** All documents must match the member's name, date of birth, and Medicare Beneficiary Identifier (MBI) on file.
4. **Legibility:** OCR-extracted documents must pass a confidence threshold. Flag low-confidence extractions for human review.

### Evidence Confidence Scoring (for agent)
| Score | Action |
|---|---|
| High (clear document, all fields match) | Proceed automatically |
| Medium (minor discrepancy — name variation, old address) | Flag for supervisor review; hold enrollment |
| Low (unclear document, key fields missing, or contradictory data) | Reject evidence item; trigger outreach for replacement |

### Common Evidence Substitutions
| Primary Evidence | Acceptable Substitute |
|---|---|
| Employer termination letter | COBRA election notice + paystub showing last benefit date |
| New address lease | Two of: utility bill, bank statement, USPS change of address |
| Medicaid eligibility letter | State Medicaid database query (plan can run directly) |
| Discharge papers from facility | Attending physician letter on facility letterhead |

---

## Part V — Effective Date Calculation Rules

| SEP Type | Effective Date Rule |
|---|---|
| SEP-01 (Loss of GHP) — MA/Part D | 1st of month following election |
| SEP-01 (Loss of GHP) — Part A/B | Up to 3 months retroactive from signup |
| SEP-02 (Move) | Member selects: up to 3 months after election submission month |
| SEP-03 (Dual Eligible) | 1st of next month; AEP elections = January 1 |
| SEP-04 (LIS/Extra Help) | 1st of month following election |
| SEP-05 (Institutionalized) | 1st of month following election |
| SEP-06 (Incarceration Release) | 1st of month following election |
| SEP-07 (Disaster) | Case-by-case per CMS guidance |
| SEP-08 (5-Star) | 1st of month following election |
| SEP-09 (Plan Termination) | 1st of month following election; retroactive if gap prevention needed |
| SEP-10 (Seamless Conversion) | 1st of month following election |
| SEP-11 (Federal Error) | 1st of month following election |
| SEP-12 (Exceptional) | Prospective OR retroactive per CMS |
| SEP-13 (SPAP) | 1st of month following election |
| SEP-14 (Trial Period) | 1st of month following election |

---

## Part VI — ESRD Hard Stop

**Rule:** Individuals diagnosed with End-Stage Renal Disease (ESRD) **cannot enroll in a Medicare Advantage plan** (with limited exceptions for existing enrollees whose condition develops post-enrollment, or ESRD SNPs where available under BPCI-A model).

**Agent action when ESRD is detected:**
1. Halt MA enrollment processing.
2. Route member to Original Medicare (Parts A + B) + standalone Part D plan.
3. Flag case with reason: "ESRD — MA enrollment prohibited except via ESRD SNP."
4. Notify case worker to check for ESRD SNP availability in area.

---

## Part VII — Late Enrollment Penalty Awareness

The agent must flag potential late enrollment penalties before finalizing any enrollment:

| Coverage | Penalty |
|---|---|
| Part B | 10% premium increase per 12-month period without Part B while enrolled in Part A |
| Part D | 1% of national base beneficiary premium (~$36.78/month in 2025) per month without creditable coverage |

**Agent action:** If a gap in Part D coverage is detected in the member's history, calculate the potential penalty and include in the case summary sent to the case worker. Do NOT suppress this information.

---

## Part VIII — Escalation Triggers

The agent must escalate to a human compliance reviewer for any of the following:

1. SEP type is Federal Error (SEP-11) — requires CMS determination
2. SEP type is Exceptional Circumstances (SEP-12) — requires CMS determination
3. ESRD diagnosis detected
4. Evidence confidence score is "Low" after one outreach attempt
5. Member disputes a denial
6. Duplicate enrollment detected for same member within 30 days
7. Broker license is expired or cannot be verified
8. Retroactive effective date requested (beyond standard rules)
9. Any case involving immigration status questions

---

## Part IX — What the Agent Does NOT Do

These are handled by other system components. The SEP Agent must call them as tools, not replicate them:

| Task | Handled By |
|---|---|
| EDI 834 file generation | CMS submission tool |
| Member ID assignment | Member platform |
| Plan availability lookup by ZIP | CMS Plan Finder API |
| Welcome letter generation | CRM correspondence engine |
| Broker license verification | Broker portal lookup tool |
| CMS EVS eligibility API call | Eligibility verification tool |
| Exact-match duplicate detection | CRM deduplication engine |

---

*Sources: 42 CFR § 422.62; CMS CY2025 Enrollment & Disenrollment Guidance; CMS SEP Verification and Complex Case Scenarios; NCOA Medicare Advantage SEP Guide; CMS Medicare.gov SEP Reference; Medicare Interactive SEP Chart.*
