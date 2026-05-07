# Renewal and Retro Coverage Pipeline Testing

This folder contains comprehensive EDI test data for testing the renewal and retro coverage agentic pipeline flows.

## Test Scenarios

### 1. Renewal Pipeline Tests
- **renewal_single_subscriber.edi** - Single subscriber with prior APTC and prior premium
- **renewal_with_dependents.edi** - Subscriber with dependents, all with renewal coverage
- **renewal_mixed_coverage.edi** - Subscriber with multiple coverage types (some renewal, some new)
- **renewal_high_value.edi** - High-value renewal case with significant APTC amounts

### 2. Retro Coverage Pipeline Tests
- **retro_single_subscriber.edi** - Single subscriber with retroactive coverage start date
- **retro_with_dependents.edi** - Subscriber with dependents, all with retro coverage
- **retro_mixed_dates.edi** - Subscriber with mixed coverage dates (some retro, some current)
- **retro_long_lookback.edi** - Retro coverage with significant lookback period

### 3. Mixed Pipeline Tests
- **mixed_renewal_and_retro.edi** - Single file with both renewal and retro members
- **mixed_all_types.edi** - File with OEP, SEP, Renewal, and Retro coverage

### 4. Edge Cases
- **renewal_no_prior_premium.edi** - Renewal with prior APTC but no prior premium
- **retro_current_date.edi** - Coverage starting today (boundary case)
- **retro_very_old.edi** - Very old retroactive coverage (6+ months)

## Expected Classification Results

### Renewal Files
- Classification: `RENEWAL`
- Routing Target: `RenewalProcessorAgent`
- Batch ID Format: `BCH-YYYYMMDD-REN-XXX`

### Retro Coverage Files
- Classification: `RETRO_COVERAGE`
- Routing Target: `RetroEnrollmentOrchestratorAgent`
- Batch ID Format: `BCH-YYYYMMDD-RET-XXX`

## Testing Workflow

1. **Upload Files**
   - Go to File Intake page
   - Upload EDI files

2. **Structure Validation**
   - Files auto-validate on upload
   - Check for parsing errors

3. **Business Validation**
   - Go to Integrity Workbench
   - Click "Initiate Member Validations"
   - Wait for validation to complete

4. **Classification**
   - Go to Classifier page
   - Click "Run Classifier"
   - Verify classification results

5. **Batch Generation**
   - Go to Release Staging page
   - Click "Generate Batch"
   - Verify separate batches created for each pipeline

6. **Pipeline Execution**
   - Click "Initiate" for each batch
   - Monitor pipeline execution
   - Verify correct agent processing

## File Format

All files follow the EDI 834 format with:
- ISA segment: Interchange header
- GS segment: Functional group header
- ST segment: Transaction set header
- BGN segment: Beginning of transaction
- REF segments: Reference information (policy, prior APTC, prior premium)
- DTP segments: Date information
- N1/N3/N4 segments: Name and address
- INS segment: Insurance line
- NM1 segment: Name
- DMG segment: Demographics
- PER segment: Contact information
- HD segment: Health coverage
- SE segment: Transaction set trailer
- GE segment: Functional group trailer
- IEA segment: Interchange trailer

## Key Fields for Classification

### Renewal Detection
- `REF*1L*<amount>` - Prior APTC
- `REF*1M*<amount>` - Prior gross premium
- If either exists → Classification: RENEWAL

### Retro Coverage Detection
- `DTP*348*D8*<date>` - Coverage start date
- If date < today → Classification: RETRO_COVERAGE

## Testing Checklist

- [ ] All files parse successfully
- [ ] All members created in database
- [ ] Business validation passes
- [ ] Classification runs successfully
- [ ] Renewal files classified as RENEWAL
- [ ] Retro files classified as RETRO_COVERAGE
- [ ] Separate batches created for each pipeline
- [ ] Correct routing targets assigned
- [ ] Batch IDs include pipeline type
- [ ] Agents receive correct batches
- [ ] Pipeline execution completes successfully

## Troubleshooting

### Files Not Parsing
- Check EDI format (segments must end with ~)
- Verify all required segments present
- Check for special characters in names/addresses

### Classification Not Running
- Ensure business validation completed first
- Check that members have "Ready" status
- Verify classification endpoint is working

### Batches Not Creating
- Ensure members are classified (have `classification` field)
- Check that members have "Ready" status
- Verify batch creation endpoint is working

### Wrong Routing
- Check `routing_target` field in member document
- Verify agent names match exactly
- Check batch `pipeline_type` field

## Notes

- All test data uses realistic subscriber information
- Dates are set to May 2026 for consistency
- Coverage amounts are realistic for healthcare plans
- Dependent relationships are properly structured
- All files include proper EDI formatting and validation

