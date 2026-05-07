# Renewal and Retro Coverage Pipeline Testing Guide

## Overview

This guide provides step-by-step instructions for testing the renewal and retro coverage agentic pipeline flows using the comprehensive EDI test data.

## Test Data Files

### Renewal Pipeline (4 files)
1. **renewal_single_subscriber.edi** - Basic renewal case
   - Subscriber: Michael Johnson
   - Prior APTC: $250, Prior Premium: $500
   - Expected: RENEWAL classification

2. **renewal_with_dependents.edi** - Renewal with family coverage
   - Subscriber: Sarah Williams + 2 dependents
   - Prior APTC: $450, Prior Premium: $900
   - Expected: RENEWAL classification

3. **renewal_mixed_coverage.edi** - Multiple coverage types
   - Subscriber: David Chen + 2 dependents
   - Prior APTC: $350, Prior Premium: $700
   - Expected: RENEWAL classification

4. **renewal_high_value.edi** - High-value renewal
   - Subscriber: Carlos Martinez + 3 dependents
   - Prior APTC: $1,250, Prior Premium: $2,500
   - Expected: RENEWAL classification

5. **renewal_no_prior_premium.edi** - Edge case: APTC only
   - Subscriber: Thomas Wilson
   - Prior APTC: $175 (no prior premium)
   - Expected: RENEWAL classification

### Retro Coverage Pipeline (4 files)
1. **retro_single_subscriber.edi** - Basic retro case
   - Subscriber: Robert Anderson
   - Coverage Start: 2026-03-01 (past date)
   - Expected: RETRO_COVERAGE classification

2. **retro_with_dependents.edi** - Retro with family coverage
   - Subscriber: Jennifer Thompson + 2 dependents
   - Coverage Start: 2026-02-15 (past date)
   - Expected: RETRO_COVERAGE classification

3. **retro_mixed_dates.edi** - Multiple coverage dates
   - Subscriber: Antonio Garcia + 2 dependents
   - Coverage Start: 2026-01-01 (past date)
   - Expected: RETRO_COVERAGE classification

4. **retro_long_lookback.edi** - Very old retro coverage
   - Subscriber: Christopher Brown + 2 dependents
   - Coverage Start: 2595-11-01 (very old)
   - Expected: RETRO_COVERAGE classification

5. **retro_current_date.edi** - Edge case: Today's date
   - Subscriber: Jessica Davis
   - Coverage Start: 2026-05-06 (today)
   - Expected: OEP_ENROLLMENT (not retro)

6. **retro_very_old.edi** - Edge case: 6+ months old
   - Subscriber: Richard Miller + 1 dependent
   - Coverage Start: 2595-09-01 (very old)
   - Expected: RETRO_COVERAGE classification

### Mixed Pipeline (2 files)
1. **mixed_renewal_and_retro.edi** - Both renewal and retro
   - Member 1: Elizabeth Taylor (OEP)
   - Member 2: James Anderson (Retro - 2026-03-01)
   - Expected: 2 different classifications

2. **mixed_all_types.edi** - All classification types
   - Member 1: Elizabeth Moore (OEP)
   - Member 2: Michael Taylor (RENEWAL)
   - Member 3: David Anderson (RETRO)
   - Expected: 3 different classifications

## Testing Workflow

### Phase 1: File Upload and Parsing

**Step 1: Upload Files**
```
1. Navigate to: http://localhost:3000/file-intake
2. Click "Choose Files" or drag files
3. Select all EDI files from renewal_and_retro_pipeline_testing folder
4. Click "Upload"
```

**Expected Results:**
- ✅ All files upload successfully
- ✅ Files appear in the file list
- ✅ Status shows "Uploaded"

**Step 2: Structure Validation**
```
1. Files auto-validate on upload
2. Check for any validation errors
3. Verify all files pass validation
```

**Expected Results:**
- ✅ All files pass structure validation
- ✅ No parsing errors
- ✅ Files ready for next step

### Phase 2: Business Validation

**Step 3: Run Business Validation**
```
1. Navigate to: http://localhost:3000/integrity-workbench
2. Click "Initiate Member Validations"
3. Wait for validation to complete
4. Check member counts
```

**Expected Results:**
- ✅ All members validated
- ✅ Members appear in "Ready" section
- ✅ No validation errors
- ✅ Total members: ~20 (varies by files uploaded)

**Verification:**
```
Check member statuses:
- All should be "Ready"
- No "Pending Business Validation"
- No "Awaiting Clarification"
```

### Phase 3: Classification

**Step 4: Run Classification**
```
1. Navigate to: http://localhost:3000/classifier
2. Click "Run Classifier"
3. Wait for classification to complete
4. Check classification results
```

**Expected Results:**
- ✅ Classification completes successfully
- ✅ Members classified into categories:
   - Ready: 0 (all should be classified)
   - Awaiting Clarification: 0 (or minimal)
   - Not Enough Info: 0 (or minimal)

**Verification - Check Classifications:**

**Renewal Files:**
```
renewal_single_subscriber.edi:
  ✅ Michael Johnson → RENEWAL
  ✅ Routing Target: RenewalProcessorAgent

renewal_with_dependents.edi:
  ✅ Sarah Williams → RENEWAL
  ✅ Routing Target: RenewalProcessorAgent

renewal_mixed_coverage.edi:
  ✅ David Chen → RENEWAL
  ✅ Routing Target: RenewalProcessorAgent

renewal_high_value.edi:
  ✅ Carlos Martinez → RENEWAL
  ✅ Routing Target: RenewalProcessorAgent

renewal_no_prior_premium.edi:
  ✅ Thomas Wilson → RENEWAL
  ✅ Routing Target: RenewalProcessorAgent
```

**Retro Files:**
```
retro_single_subscriber.edi:
  ✅ Robert Anderson → RETRO_COVERAGE
  ✅ Routing Target: RetroEnrollmentOrchestratorAgent

retro_with_dependents.edi:
  ✅ Jennifer Thompson → RETRO_COVERAGE
  ✅ Routing Target: RetroEnrollmentOrchestratorAgent

retro_mixed_dates.edi:
  ✅ Antonio Garcia → RETRO_COVERAGE
  ✅ Routing Target: RetroEnrollmentOrchestratorAgent

retro_long_lookback.edi:
  ✅ Christopher Brown → RETRO_COVERAGE
  ✅ Routing Target: RetroEnrollmentOrchestratorAgent

retro_current_date.edi:
  ✅ Jessica Davis → OEP_ENROLLMENT (not retro)
  ✅ Routing Target: EnrollmentRouterAgent

retro_very_old.edi:
  ✅ Richard Miller → RETRO_COVERAGE
  ✅ Routing Target: RetroEnrollmentOrchestratorAgent
```

**Mixed Files:**
```
mixed_renewal_and_retro.edi:
  ✅ Elizabeth Taylor → OEP_ENROLLMENT
  ✅ James Anderson → RETRO_COVERAGE

mixed_all_types.edi:
  ✅ Elizabeth Moore → OEP_ENROLLMENT
  ✅ Michael Taylor → RENEWAL
  ✅ David Anderson → RETRO_COVERAGE
```

### Phase 4: Batch Generation

**Step 5: Generate Batches**
```
1. Navigate to: http://localhost:3000/release-staging
2. Click "Generate Batch"
3. Wait for batch creation
4. Check batch results
```

**Expected Results:**
- ✅ Multiple batches created (not just one)
- ✅ Batches organized by pipeline type
- ✅ Success message shows batch count and types

**Verification - Check Batch Creation:**

**Expected Batches:**
```
Batch 1: Renewal Pipeline
  ✅ Batch ID: BCH-20260506-REN-XXX
  ✅ Pipeline Type: RENEWAL
  ✅ Routing Target: RenewalProcessorAgent
  ✅ Members: 5 (all renewal files)

Batch 2: Retro Coverage Pipeline
  ✅ Batch ID: BCH-20260506-RET-XXX
  ✅ Pipeline Type: RETRO_COVERAGE
  ✅ Routing Target: RetroEnrollmentOrchestratorAgent
  ✅ Members: 5 (all retro files)

Batch 3: Enrollment Pipeline
  ✅ Batch ID: BCH-20260506-ENR-XXX
  ✅ Pipeline Type: ENROLLMENT
  ✅ Routing Target: EnrollmentRouterAgent
  ✅ Members: 3 (OEP members from mixed files)
```

### Phase 5: Pipeline Execution

**Step 6: Initiate Batches**
```
1. For each batch, click "Initiate"
2. Monitor pipeline execution
3. Check logs for each pipeline
4. Verify correct agent processing
```

**Expected Results:**
- ✅ Renewal batch sent to RenewalProcessorAgent
- ✅ Retro batch sent to RetroEnrollmentOrchestratorAgent
- ✅ Enrollment batch sent to EnrollmentRouterAgent
- ✅ Each agent processes members correctly

**Verification - Check Pipeline Logs:**

**Renewal Pipeline:**
```
✅ RenewalProcessorAgent receives batch
✅ Processes 5 renewal members
✅ Updates member status
✅ Completes successfully
```

**Retro Coverage Pipeline:**
```
✅ RetroEnrollmentOrchestratorAgent receives batch
✅ Processes 5 retro members
✅ Updates member status
✅ Completes successfully
```

**Enrollment Pipeline:**
```
✅ EnrollmentRouterAgent receives batch
✅ Processes 3 OEP members
✅ Updates member status
✅ Completes successfully
```

## Database Verification

### Check Member Documents

**Renewal Members:**
```javascript
db.members.findOne({ subscriber_id: "RENEWAL001" })
{
  subscriber_id: "RENEWAL001",
  status: "Ready",
  classification: "RENEWAL",
  routing_target: "RenewalProcessorAgent",
  prior_aptc: "250",
  prior_gross_premium: "500",
  batch_id: "BCH-20260506-REN-XXX"
}
```

**Retro Members:**
```javascript
db.members.findOne({ subscriber_id: "RETRO001" })
{
  subscriber_id: "RETRO001",
  status: "Ready",
  classification: "RETRO_COVERAGE",
  routing_target: "RetroEnrollmentOrchestratorAgent",
  coverage_start_date: "2026-03-01",
  batch_id: "BCH-20260506-RET-XXX"
}
```

### Check Batch Documents

**Renewal Batch:**
```javascript
db.batches.findOne({ pipeline_type: "RENEWAL" })
{
  id: "BCH-20260506-REN-XXX",
  status: "Awaiting Approval",
  pipeline_type: "RENEWAL",
  routing_target: "RenewalProcessorAgent",
  membersCount: 5,
  member_ids: ["RENEWAL001", "RENEWAL002", ...]
}
```

**Retro Batch:**
```javascript
db.batches.findOne({ pipeline_type: "RETRO_COVERAGE" })
{
  id: "BCH-20260506-RET-XXX",
  status: "Awaiting Approval",
  pipeline_type: "RETRO_COVERAGE",
  routing_target: "RetroEnrollmentOrchestratorAgent",
  membersCount: 5,
  member_ids: ["RETRO001", "RETRO002", ...]
}
```

## Troubleshooting

### Issue: Files Not Parsing
**Symptoms:**
- Upload fails
- Validation errors appear
- Files stuck in "Uploaded" status

**Solutions:**
1. Check EDI format (all segments must end with ~)
2. Verify all required segments present
3. Check for special characters in names/addresses
4. Review parser logs for specific errors

### Issue: Classification Not Running
**Symptoms:**
- Classification button does nothing
- Members stay in "Ready" status
- No classification results

**Solutions:**
1. Ensure business validation completed first
2. Check that members have "Ready" status
3. Verify classification endpoint is working
4. Check server logs for errors

### Issue: Wrong Classifications
**Symptoms:**
- Renewal files classified as OEP
- Retro files classified as OEP
- Wrong routing targets

**Solutions:**
1. Check prior_aptc field in member document
2. Check coverage_start_date field
3. Verify classification logic in server/routers/members.py
4. Check parser for REF segment handling

### Issue: Batches Not Creating
**Symptoms:**
- Generate Batch button does nothing
- No batches created
- Error message appears

**Solutions:**
1. Ensure members are classified (have `classification` field)
2. Check that members have "Ready" status
3. Verify batch creation endpoint is working
4. Check server logs for errors

### Issue: Wrong Routing
**Symptoms:**
- All batches go to EnrollmentRouterAgent
- Renewal batches not created
- Retro batches not created

**Solutions:**
1. Check `routing_target` field in member document
2. Verify agent names match exactly
3. Check batch `pipeline_type` field
4. Review batch creation logic in server/routers/batches.py

## Performance Metrics

### Expected Timings
- File Upload: < 5 seconds
- Structure Validation: < 10 seconds
- Business Validation: 30-60 seconds
- Classification: 30-60 seconds
- Batch Generation: < 5 seconds
- Pipeline Execution: 2-5 minutes per batch

### Expected Throughput
- Files: 10 files
- Members: ~20 members
- Batches: 3 batches
- Success Rate: 100%

## Success Criteria

✅ **All tests pass if:**
1. All files parse successfully
2. All members created in database
3. Business validation passes
4. Classification runs successfully
5. Renewal files classified as RENEWAL
6. Retro files classified as RETRO_COVERAGE
7. OEP files classified as OEP_ENROLLMENT
8. Separate batches created for each pipeline
9. Correct routing targets assigned
10. Batch IDs include pipeline type
11. Agents receive correct batches
12. Pipeline execution completes successfully
13. Member statuses updated correctly
14. No errors in logs

## Next Steps

After successful testing:
1. Document any issues found
2. Review classification accuracy
3. Monitor pipeline performance
4. Gather feedback from stakeholders
5. Plan for production deployment

