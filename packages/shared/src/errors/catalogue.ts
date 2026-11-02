/**
 * Error code catalogue (design doc Section 4, Appendix D). Code = E + #TASK number (2 digits) +
 * sequence (2 digits). Each code is listed once. `appendixD: true` marks the 22 errors engineers
 * meet in normal use; the others are shown by the system or used by developers.
 * Failed engineering checks are not errors: they are check codes C1-C12 (Section 10.12).
 */

export type ErrorEffect = 'blocks' | 'warning' | 'error';

export interface ErrorEntry {
  code: string;
  /** #TASK the error belongs to. */
  task: string;
  message: string;
  effect: ErrorEffect;
  /** Why it happens (Appendix D). */
  cause: string;
  /** What the engineer does (Appendix D). */
  action: string;
  appendixD: boolean;
}

const e = (
  code: string,
  message: string,
  effect: ErrorEffect,
  cause: string,
  action: string,
  appendixD = false,
): ErrorEntry => ({
  code,
  task: `#TASK-${code.slice(1, 3)}`,
  message,
  effect,
  cause,
  action,
  appendixD,
});

export const ERROR_CATALOGUE = [
  // #TASK-01 Authentication
  e(
    'E0101',
    'Email or password is incorrect.',
    'error',
    'Wrong email or password (the message never says which).',
    'Check the details and sign in again.',
  ),
  e('E0102', 'Please sign in.', 'error', 'No session, or the session expired.', 'Sign in again.'),
  e(
    'E0103',
    'Too many sign-in attempts. Try again in a few minutes.',
    'error',
    'Login attempt limit reached (Figure 7.3).',
    'Wait, then sign in again.',
  ),
  // #TASK-02 Project picker
  e(
    'E0201',
    'Project not found.',
    'error',
    'The project does not exist or you are not assigned to it.',
    'Ask the Technical Lead to assign you.',
  ),
  e(
    'E0202',
    'Only the Technical Lead can create or import projects.',
    'error',
    'Amendment A-01.',
    'Ask the Technical Lead.',
  ),
  e(
    'E0203',
    'The project file cannot be imported.',
    'error',
    'The .json file is damaged, not a NeuroMEP project or an unsupported version.',
    'Export the project again from NeuroMEP.',
  ),
  // #TASK-03 Project set-up
  e(
    'E0301',
    'Only the Technical Lead can change Project Set-up.',
    'error',
    'Page 1 is read-only for other roles.',
    'Ask the Technical Lead.',
  ),
  // #TASK-06 Plans
  e(
    'E0601',
    'Floor plan could not be opened',
    'blocks',
    'The PDF is damaged, password-protected or not a drawing.',
    'Upload a different PDF for that floor (Page 1).',
    true,
  ),
  e(
    'E0602',
    'Only PDF files can be uploaded.',
    'error',
    'The file is not a PDF.',
    'Export the plan as PDF and upload it.',
  ),
  e(
    'E0603',
    'The plan is larger than 20 MB.',
    'error',
    'Upload limit (FR-07).',
    'Reduce the PDF size (fewer layers or images) and upload again.',
  ),
  e(
    'E0604',
    'The plan has more than one page.',
    'error',
    'One single-page PDF per floor (FR-07).',
    'Upload only the page of this floor.',
  ),
  e(
    'E0605',
    'Plan file not found.',
    'error',
    'The stored plan file is missing.',
    'Upload the plan again.',
  ),
  // #TASK-07 Calibration
  e(
    'E0701',
    'Plan not calibrated',
    'blocks',
    'Cables drawn on an uncalibrated plan have no real length.',
    'Calibrate the plan with two points of known distance (Page 1).',
    true,
  ),
  // #TASK-08 Persistence
  e(
    'E0801',
    'Changes not saved yet',
    'warning',
    'Connection to the server was lost; changes are kept and retried.',
    'Check the connection; do not close the browser until "Saved" shows.',
    true,
  ),
  e(
    'E0802',
    'Someone else saved this project since you opened it.',
    'error',
    'Optimistic lock: the project version changed.',
    'Reload to see their changes, then re-apply yours.',
  ),
  e(
    'E0803',
    'The project data is not valid.',
    'error',
    'A save was rejected by the shared schema.',
    'Report the issue to support.',
  ),
  // #TASK-09 / #TASK-10 Collaboration
  e(
    'E0902',
    'Element was changed by another user',
    'warning',
    'Your edit was based on an older version of the element.',
    'The element reloads; re-apply your change.',
    true,
  ),
  e(
    'E1001',
    'Element is being edited by another engineer',
    'blocks',
    'Another user holds the lock ("Being edited by <name>").',
    'Wait for release (60 s idle) or ask that user.',
    true,
  ),
  e(
    'E1002',
    'You can change only your own discipline layer.',
    'error',
    'The change touches components of another discipline, or Project Set-up (Section 2).',
    'Ask the engineer of that discipline or the Technical Lead.',
  ),
  e(
    'E1003',
    'Floor flagged done and locked',
    'blocks',
    'The floor was flagged done for this discipline (A-08): it is saved and locked.',
    'Ask the Technical Lead to reopen the floor.',
  ),
  // #TASK-13 / #TASK-14 Cables and topology
  e(
    'E1301',
    'Cable not connected at both ends',
    'blocks',
    'A cable ends in empty space or on a wrong port.',
    'Snap both ends to equipment ports.',
    true,
  ),
  e(
    'E1401',
    'Connection not allowed',
    'blocks',
    'The link breaks the topology rules (Section 3), e.g. a loop or a DB feeding an MDB.',
    'Reconnect following the supply order source > MDB > SMDB/MCC > DB.',
    true,
  ),
  // #TASK-15 Loads
  e(
    'E1501',
    'DB has no load entered',
    'blocks',
    'A DB has neither kW per phase nor area x W/m2.',
    'Enter the load in the DB properties.',
    true,
  ),
  e(
    'E1502',
    'Load value out of range',
    'blocks',
    'Negative kW, power factor outside 0.5-1.0 or efficiency outside 0.5-1.0.',
    'Correct the value in the properties panel.',
    true,
  ),
  e(
    'E1503',
    'Load upload row not matched',
    'warning',
    'A DB name in the uploaded Excel sheet does not match any DB tag in the project.',
    'Correct the DB name in the sheet or create the DB, then upload again.',
    true,
  ),
  // #TASK-18 Network completeness
  e(
    'E1801',
    'Element not connected to a source',
    'warning',
    'No path to a transformer or generator; results stay Provisional.',
    'Connect it in Building view through the riser to the MDB.',
    true,
  ),
  e(
    'E1802',
    'Floor not connected to the riser',
    'warning',
    'A floor has panels but no tap-off from the riser.',
    'Add the tap-off for that floor in Building view.',
    true,
  ),
  // #TASK-19..#TASK-26 Engine
  e(
    'E1901',
    'Demand factor not confirmed',
    'warning',
    'The factor for this load type is still TBC, so 1.0 is used and the result is Provisional.',
    'Senior engineer confirms the factor on Page 1.',
    true,
  ),
  e(
    'E2001',
    'No breaker found in the catalogue',
    'blocks',
    'The design current is above the largest device of the selected type.',
    'Split the load, pick another breaker type or frame, or add catalogue data.',
    true,
  ),
  e(
    'E2002',
    'Fault level above the highest breaker rating',
    'blocks',
    'The maximum fault current at the panel is above 85 kA, the highest available ACB rating.',
    'Check the source data; the senior engineer decides on a current-limiting solution.',
    true,
  ),
  e(
    'E2003',
    'Design current cannot be calculated',
    'blocks',
    'Power factor, motor efficiency or capacitor rating is missing; the engine never assumes it.',
    'Enter the missing value on the load, or wait for the confirmed default (OI-30).',
  ),
  e(
    'E2101',
    'Cable size outside the table',
    'blocks',
    'The required size is above the largest size in the table for this construction.',
    'Allow parallel runs, or change cable type or installation method.',
    true,
  ),
  e(
    'E2102',
    'Derating factor not available',
    'blocks',
    'Temperature, grouping or installation combination is not in the table; the engine never guesses.',
    'Change the installation input or ask the administrator to add the table value.',
    true,
  ),
  e(
    'E2301',
    'Source data missing for fault level',
    'blocks',
    'Transformer kVA / impedance, generator data or upstream fault level not entered.',
    'Complete the source properties in Building view.',
    true,
  ),
  e(
    'E2402',
    'Device data required',
    'warning',
    'Breaker let-through (I2t) data is missing, so the thermal check cannot pass.',
    'Add the manufacturer data or choose a catalogued device.',
    true,
  ),
  e(
    'E2601',
    'Cable Size could not find a solution',
    'blocks',
    'No size passes all checks after 50 attempts.',
    'Review the failing check shown (e.g. C2 voltage drop) and change length, route or limits.',
    true,
  ),
  e(
    'E2690',
    'Results differ between screen and server',
    'warning',
    'The server re-check on save or export got a different result.',
    'Press Cable Size again; if it repeats, report the run ID to support.',
    true,
  ),
  // #TASK-31 Exports
  e(
    'E3101',
    'Export blocked',
    'blocks',
    'Results are Out of date or have failing checks.',
    'Press Cable Size, then fix or accept the failing checks before exporting.',
    true,
  ),
] as const satisfies readonly ErrorEntry[];

export type ErrorCode = (typeof ERROR_CATALOGUE)[number]['code'];

const BY_CODE = new Map<string, ErrorEntry>(ERROR_CATALOGUE.map((x) => [x.code, x]));

export function errorEntry(code: ErrorCode): ErrorEntry {
  return BY_CODE.get(code)!;
}

/** "Message (E0802)" - plain language with the code (Section 6 Usability). */
export function errorText(code: ErrorCode): string {
  return `${errorEntry(code).message.replace(/\.$/, '')} (${code})`;
}

/** Body of an API error response. */
export interface ApiErrorBody {
  code: ErrorCode;
  error: string;
  [extra: string]: unknown;
}
