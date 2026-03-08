# CAC Forms - Event Registration with Discourse SSO

## Overview
React + Vite + TypeScript SPA that uses Discourse as a login provider, collects event registration data via **configurable form schemas**, and pushes submissions to Google Sheets. Verified users skip pre-filled profile fields; others fill everything.

---

## Architecture

```
Browser (React SPA)
  ├── Auth: Discourse User API Keys (RSA-OAEP flow, client-side only)
  ├── Forms: Config-driven (TS config) → React Hook Form + Zod + shadcn/ui
  └── Data: POST to Google Apps Script proxy → Google Sheets
```

**Key decisions:**
- **Discourse User API Keys** (not DiscourseConnect): Works client-side, no server needed.
- **Google Apps Script proxy**: Avoids exposing Google credentials in client code.
- **shadcn/ui**: Tailwind-based, copy-paste components built on Radix UI primitives. You own the code.
- **Config-driven forms**: Form fields defined in TypeScript config files — add/remove/reorder fields by editing config, not components.

---

## Tech Stack & Dependencies

- `react`, `react-dom`, `react-router-dom`
- `react-hook-form`, `@hookform/resolvers`, `zod`
- `tailwindcss`, `postcss`, `autoprefixer`
- shadcn/ui components (installed via `npx shadcn@latest init` + `npx shadcn@latest add ...`)
- No crypto libraries needed — Web Crypto API handles RSA-OAEP natively

---

## Project Structure

```
cac-forms/
├── .env.example
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── components.json              # shadcn/ui config
├── tsconfig*.json
├── apps-script/
│   └── sheets-proxy.js          # Deployed separately in Google Apps Script
└── src/
    ├── main.tsx
    ├── App.tsx                   # Router setup
    ├── index.css                 # Tailwind + shadcn imports
    ├── lib/
    │   ├── utils.ts              # shadcn cn() helper
    │   ├── crypto-utils.ts       # RSA-OAEP keygen, PEM export, payload decrypt
    │   ├── discourse-auth.ts     # Auth URL builder, initiateLogin()
    │   ├── discourse-api.ts      # Fetch user profile via User-Api-Key
    │   ├── google-sheets.ts      # POST to Apps Script proxy
    │   └── storage.ts            # localStorage helpers
    ├── types/
    │   ├── discourse.ts          # Discourse user profile types
    │   ├── forms.ts              # FormFieldConfig type, form data types
    │   └── auth.ts               # AuthState, AuthUser
    ├── config/
    │   ├── forms.ts              # *** FORM SCHEMA CONFIGS (edit this to change forms) ***
    │   └── discourse-fields.ts   # Mapping of Discourse field IDs to names
    ├── context/
    │   └── AuthContext.tsx
    ├── hooks/
    │   ├── useAuth.ts
    │   └── useFormSubmit.ts
    ├── components/
    │   ├── ui/                   # shadcn/ui components (auto-generated)
    │   │   ├── button.tsx
    │   │   ├── input.tsx
    │   │   ├── textarea.tsx
    │   │   ├── select.tsx
    │   │   ├── label.tsx
    │   │   ├── card.tsx
    │   │   ├── alert.tsx
    │   │   └── ...
    │   ├── layout/
    │   │   ├── Header.tsx
    │   │   ├── Footer.tsx
    │   │   └── PageLayout.tsx
    │   ├── auth/
    │   │   ├── LoginButton.tsx
    │   │   ├── AuthCallback.tsx
    │   │   └── ProtectedRoute.tsx
    │   └── forms/
    │       ├── DynamicForm.tsx    # Renders any form from a FormConfig
    │       ├── DynamicField.tsx   # Renders a single field based on FieldConfig type
    │       └── FormWrapper.tsx    # Shared chrome: card, title, submit, status
    └── pages/
        ├── HomePage.tsx
        ├── FormPage.tsx           # Generic form page (reads config by route param)
        ├── AuthCallbackPage.tsx
        ├── SuccessPage.tsx
        └── NotFoundPage.tsx
```

---

## Config-Driven Forms

### The Core Idea
Instead of hardcoded `RSVPFields.tsx` / `WorkshopFields.tsx` components, forms are defined as TypeScript config objects. A single `DynamicForm` component renders any form based on its config. To change a form, you edit `src/config/forms.ts` — no component changes needed.

### Config Types (`src/types/forms.ts`)

```typescript
type FieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio';

interface FormFieldConfig {
  name: string;                         // Field key (used in form data & sheet columns)
  label: string;                        // Display label
  type: FieldType;                      // Input type
  placeholder?: string;
  required?: boolean;
  validation?: {                        // Optional Zod-compatible rules
    min?: number;                       // min length (string) or min value (number)
    max?: number;
    pattern?: string;                   // regex pattern
    message?: string;                   // custom error message
  };
  options?: { label: string; value: string }[];  // For select/radio
  discourseField?: string;             // If set, pre-fill from Discourse user data
                                        // e.g. "name", "email", "bio_raw", "user_fields.1"
  verifiedReadOnly?: boolean;           // If true, read-only for verified users
  fullWidth?: boolean;                  // Span full width (for textarea, etc.)
}

interface FormConfig {
  id: string;                           // URL slug: "rsvp", "workshop"
  title: string;                        // Display title
  description?: string;
  sheetTab: string;                     // Google Sheet tab name
  fields: FormFieldConfig[];
  submitLabel?: string;                 // Button text (default: "Submit")
}
```

### Example Config (`src/config/forms.ts`)

```typescript
export const formConfigs: FormConfig[] = [
  {
    id: 'rsvp',
    title: 'Event RSVP',
    description: 'Register your attendance for the community event.',
    sheetTab: 'RSVP',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true,
        discourseField: 'name', verifiedReadOnly: true },
      { name: 'email', label: 'Email', type: 'email', required: true,
        discourseField: 'email', verifiedReadOnly: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true,
        discourseField: 'user_fields.PHONE_FIELD_ID', verifiedReadOnly: true },
      { name: 'guests', label: 'Number of Guests', type: 'number',
        validation: { min: 0, max: 10 } },
      { name: 'dietary', label: 'Dietary Preferences', type: 'select',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Vegetarian', value: 'vegetarian' },
          { label: 'Vegan', value: 'vegan' },
          { label: 'Other', value: 'other' },
        ] },
      { name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
    ],
  },
  {
    id: 'workshop',
    title: 'Workshop / Speaker Submission',
    description: 'Submit a talk or workshop proposal.',
    sheetTab: 'Workshop',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true,
        discourseField: 'name', verifiedReadOnly: true },
      { name: 'email', label: 'Email', type: 'email', required: true,
        discourseField: 'email', verifiedReadOnly: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true,
        discourseField: 'user_fields.PHONE_FIELD_ID', verifiedReadOnly: true },
      { name: 'bio', label: 'Speaker Bio', type: 'textarea', required: true,
        discourseField: 'bio_raw', verifiedReadOnly: true, fullWidth: true,
        validation: { min: 20, message: 'Bio must be at least 20 characters' } },
      { name: 'talkTitle', label: 'Talk Title', type: 'text', required: true },
      { name: 'abstract', label: 'Abstract', type: 'textarea', required: true,
        fullWidth: true, validation: { min: 50 } },
      { name: 'timeSlot', label: 'Preferred Time Slot', type: 'select',
        options: [
          { label: 'Morning', value: 'morning' },
          { label: 'Afternoon', value: 'afternoon' },
          { label: 'Either', value: 'either' },
        ] },
    ],
  },
];
```

### How It Works

1. **`DynamicForm`** receives a `FormConfig` and the current user's Discourse profile
2. It builds a Zod schema dynamically from the `fields[].validation` rules
3. It computes `defaultValues` by mapping `discourseField` references to actual user data
4. It passes these to `useForm()` from React Hook Form
5. It renders each field via `DynamicField`, passing `readOnly` if the user is verified and `verifiedReadOnly` is true
6. On submit, it sends the data + field names to the Google Sheets proxy

### Adding a New Form
To add a new form (e.g., "Volunteer Signup"):
1. Add a new entry to `formConfigs` in `src/config/forms.ts`
2. Add a new tab in Google Sheets with matching column headers
3. That's it — no new components needed. The route `/form/volunteer` will render it automatically.

---

## Auth Flow (Discourse User API Keys)

```
1. User clicks "Login with Discourse"
2. App generates RSA-OAEP 2048-bit key pair (Web Crypto API)
3. Private key stored in localStorage as JWK
4. Redirect to: https://<discourse>/user-api-key/new?
     application_name=CAC+Forms&client_id=<uuid>&scopes=read
     &public_key=<PEM>&auth_redirect=<app>/auth/callback
     &nonce=<random>&padding=oaep
5. User authorizes on Discourse
6. Discourse encrypts API key with public key, redirects to callback with ?payload=<base64>
7. App decrypts payload with stored private key → gets API key
8. Validates nonce, stores API key, clears private key
9. Fetches user profile: GET /session/current.json + GET /u/<username>.json
10. Extracts: name, email, trust_level, user_fields (member_type, phone), bio_raw
```

---

## Skip-Fields Logic

```
After auth, check: user.user_fields[MEMBER_TYPE_FIELD_ID] === "verified"

If VERIFIED:
  - Fields with verifiedReadOnly: true → shown READ-ONLY, pre-filled from Discourse
  - Other fields → editable, user fills these
  - Effectively "skips" to event details

If NOT VERIFIED:
  - All fields → shown EDITABLE, pre-filled where discourseField data is available
  - Full form experience
```

---

## Google Sheets Integration

### Apps Script Proxy (`apps-script/sheets-proxy.js`)
- Deployed as Google Apps Script web app (Execute as: Me, Access: Anyone)
- Receives POST with `Content-Type: text/plain` (avoids CORS preflight)
- Validates a shared secret token
- Dynamically creates sheet tab if it doesn't exist (based on `sheetTab` from config)
- Appends row using field names from the submission as column headers
- Uses `LockService` to prevent concurrent write conflicts

### Client-side (`src/lib/google-sheets.ts`)
- `submitToSheets(sheetTab, fieldNames, formData, username, memberType)` → POST to Apps Script URL

---

## Routes (Updated for Dynamic Forms)

| Path | Component | Auth required |
|------|-----------|---------------|
| `/` | HomePage | No |
| `/form/:formId` | FormPage | Yes |
| `/auth/callback` | AuthCallbackPage | No |
| `/success` | SuccessPage | No |
| `*` | NotFoundPage | No |

The `FormPage` reads `:formId` from the URL, looks up the matching `FormConfig`, and renders `DynamicForm`. URLs: `/form/rsvp`, `/form/workshop`, etc.

---

## Environment Variables (`.env`)

```
VITE_DISCOURSE_URL=https://forum.yourcommunity.org
VITE_APP_URL=http://localhost:5173
VITE_APP_NAME=CAC Forms
VITE_MEMBER_TYPE_FIELD_ID=1
VITE_PHONE_FIELD_ID=2
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
VITE_SHEETS_SECRET=<random-hex-string>
```

---

## Discourse Admin Setup (instructions for you)

1. **CORS origins**: Add your app URL (`http://localhost:5173` for dev)
2. **Allowed user API auth redirects**: Add `http://localhost:5173/auth/callback`
3. **Create custom user field** `member_type`: Dropdown with values `verified`, `regular`, etc. Note the field ID.
4. **Create custom user field** `phone` (if not existing): Note the field ID.
5. Both field IDs go into `.env` as `VITE_MEMBER_TYPE_FIELD_ID` and `VITE_PHONE_FIELD_ID`.

## Google Sheets Setup (instructions for you)

1. Create a spreadsheet with tabs matching your form configs' `sheetTab` values (e.g., **RSVP**, **Workshop**)
2. Create an Apps Script project, paste the proxy code, set your spreadsheet ID and shared secret
3. Deploy as web app (Execute as: Me, Access: Anyone)
4. Copy deployment URL into `.env`

---

## Implementation Order

### Phase 1: Scaffolding
1. `npm create vite@latest . -- --template react-ts`
2. Install deps: `react-router-dom`, `react-hook-form`, `@hookform/resolvers`, `zod`
3. Init shadcn/ui: `npx shadcn@latest init`, then add components: `button`, `input`, `textarea`, `select`, `label`, `card`, `alert`
4. Set up directory structure, create `.env.example`
5. Create routing in `App.tsx`, build `PageLayout`/`Header`/`Footer`

### Phase 2: Auth
6. `crypto-utils.ts` — RSA-OAEP key generation + decryption (Web Crypto API)
7. `discourse-auth.ts` — auth URL builder + `initiateLogin()`
8. `storage.ts` — localStorage helpers
9. `discourse-api.ts` — fetch user profile
10. `AuthContext.tsx` — state management
11. Auth components: `LoginButton`, `AuthCallback`, `ProtectedRoute`
12. `AuthCallbackPage.tsx`

### Phase 3: Config + Form Engine
13. Define types: `FormFieldConfig`, `FormConfig`, `DiscourseUser` in `src/types/`
14. Create form configs in `src/config/forms.ts` (RSVP + Workshop)
15. Create `src/config/discourse-fields.ts` (field ID mappings)
16. Build `DynamicField.tsx` — renders one field based on its `FieldType` using shadcn/ui components
17. Build `DynamicForm.tsx` — takes a `FormConfig`, builds Zod schema dynamically, renders fields, handles submit
18. Build `FormWrapper.tsx` — card shell with title, description, submit button

### Phase 4: Google Sheets
19. Write `apps-script/sheets-proxy.js` (dynamic column handling)
20. `google-sheets.ts` — client-side submit function
21. `useFormSubmit.ts` hook

### Phase 5: Pages
22. `HomePage` — event info, links to `/form/rsvp` and `/form/workshop`
23. `FormPage` — reads `:formId`, looks up config, renders `DynamicForm`
24. `SuccessPage`, `NotFoundPage`

### Phase 6: Polish
25. Loading states, error boundaries, double-submit prevention

---

## Google Form → Same Sheet Consolidation

### Problem
A corresponding Google Form is also distributed to users. Both the React app and the Google Form need to write to the same RSVP tab in Google Sheets with consistent columns.

### Approach
Add an `onFormSubmit` trigger function to the existing `apps-script/sheets-proxy.js`. When a Google Form submission comes in, the trigger maps the form question titles to the column names that the React app uses, then appends to the same RSVP tab via the same code path.

### How it works
1. Google Form is linked to the **same spreadsheet** (it creates its own "Form Responses 1" tab automatically — that's fine, we ignore it)
2. An installable `onFormSubmit` trigger fires on every Google Form submission
3. The trigger reads the form response, maps question titles → column keys using a config object
4. It appends a row to the RSVP tab using the same column order as the React app
5. `username` is set to `"google-form"` and `memberType` to `"unverified"` for these submissions

### File to modify
- `apps-script/sheets-proxy.js` — add `onFormSubmit(e)` function and `FORM_FIELD_MAP` config

### What gets added to `sheets-proxy.js`

```javascript
// ---- GOOGLE FORM CONSOLIDATION ----
// Map Google Form question titles → column keys used by the React app.
// Update this when form questions change.
var FORM_FIELD_MAP = {
  "Full Name": "name",
  "Email ID": "email",
  "Contact Number": "phone",
  "Age Group": "age",
  "Which nights will you be joining?": "nights",
  "Equipment that you will bring": "equipment",
  "Can you bring a car and offer rides to other participants?": "canBringCar",
  "Number of seats available for other participants": "carSeats",
  "Where will you be coming from?": "location",
  "Emergency Contact Person and Number": "emergencyContact",
  "Blood Group": "bloodGroup",
  "Describe your observational skills and experience": "observationalSkills",
  "Why do you want to attend this event?": "eventReason",
  "Anything else that you would like to ask the CAC team?": "additionalQuestions",
  // Checkbox disclaimers from Google Form map to true/false
  // Add them here if you include them in the Google Form
};
var FORM_SHEET_TAB = "RSVP";

function onFormSubmit(e) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(FORM_SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(FORM_SHEET_TAB);
  }

  var responses = e.response.getItemResponses();
  var data = {};
  for (var i = 0; i < responses.length; i++) {
    var title = responses[i].getItem().getTitle();
    var answer = responses[i].getResponse();
    var key = FORM_FIELD_MAP[title];
    if (key) {
      // Checkbox questions return arrays — join them
      data[key] = Array.isArray(answer) ? answer.join(", ") : answer;
    }
  }

  // Build row matching the React app's column order
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.length === 0 || headers[0] === "") {
    // Sheet is empty — shouldn't happen if React app ran first, but handle it
    headers = ["Timestamp", "username", "memberType"];
    var allKeys = Object.keys(FORM_FIELD_MAP).map(function(t) { return FORM_FIELD_MAP[t]; });
    headers = headers.concat(allKeys);
    sheet.appendRow(headers);
  }

  var row = [];
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (h === "Timestamp") row.push(new Date());
    else if (h === "username") row.push("google-form");
    else if (h === "memberType") row.push("unverified");
    else row.push(data[h] || "");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  sheet.appendRow(row);
  lock.releaseLock();
}
```

### Setup steps (manual, in Google Apps Script editor)
1. Open the Apps Script project attached to your spreadsheet
2. Add the `onFormSubmit` function and `FORM_FIELD_MAP` / `FORM_SHEET_TAB` config
3. Update `FORM_FIELD_MAP` to match your actual Google Form question titles exactly
4. Go to **Triggers** (clock icon in sidebar) → **Add Trigger**:
   - Function: `onFormSubmit`
   - Event source: From form
   - Event type: On form submit
   - Select your linked Google Form
5. Authorize the trigger when prompted
6. Test by submitting the Google Form — check that a row appears in the RSVP tab with `username=google-form`

### Notes
- The Google Form's own "Form Responses 1" tab still gets created — you can hide or delete it
- If you change questions in the Google Form, update `FORM_FIELD_MAP` accordingly
- Fields that exist in the React app but not the Google Form (e.g. `conductCode`, `riskDisclaimer`) will be empty for Google Form submissions — this is fine
- No changes needed to the React app or frontend code

---

## Fix: Sheet Data Issues

### Issue 1: Checkbox booleans cause "Invalid data type" error
**Root cause:** When checkboxes are unchecked (`false`), the boolean value gets sent to Google Sheets. `appendRow` doesn't handle raw booleans well. Also, the Zod validation error for required checkboxes uses the full label text (the entire disclaimer paragraph) which looks ugly.

**Fix in `DynamicForm.tsx` → `handleFormSubmit`:**
- Convert all boolean values to `"Yes"` / `"No"` strings before submitting
- Already serializes `checkbox-group` arrays — add boolean conversion in the same block

**Fix in `DynamicForm.tsx` → `buildZodSchema`:**
- Shorten the refine error message for required checkboxes from `${field.label} is required` to just `"You must agree to this to continue"`

### Issue 2: Missing columns when optional/conditional fields are absent
**Root cause:** The React app only sends keys that are present in the form data. When `carSeats` is hidden (user said "No" to carpool), or `observationalSkills`/`eventReason` are skipped for verified users, those keys are missing. The `doPost` in Apps Script blindly iterates `data` keys → positional mismatch with headers.

**Fix in `DynamicForm.tsx` → `handleFormSubmit`:**
- After serialization, ensure ALL fields from `config.fields` have a key in the data (fill missing ones with `""`)
- This way every submission sends the same set of keys regardless of visibility

### Files to modify
1. `src/components/forms/DynamicForm.tsx` — boolean conversion, ensure all keys, shorter error
2. No changes needed to Apps Script — once the client always sends all keys, the existing `doPost` will work correctly since the first submission sets all headers

## Consolidate to Single Spreadsheet-Bound Script

### Problem
The Apps Script was originally designed as a standalone project using `SpreadsheetApp.openById(SPREADSHEET_ID)`. The user wants a single spreadsheet-bound script (opened via Extensions → Apps Script from the sheet) so everything lives in one place. This also enables the "From spreadsheet" → "On form submit" trigger option for Google Form consolidation.

### Changes to `apps-script/sheets-proxy.js`

**1. Remove `SPREADSHEET_ID`, use `getActiveSpreadsheet()`**
- Delete `var SPREADSHEET_ID = "..."` line
- Replace all `SpreadsheetApp.openById(SPREADSHEET_ID)` with `SpreadsheetApp.getActiveSpreadsheet()` (works because the script is bound to the spreadsheet)

**2. Rewrite `onFormSubmit(e)` for spreadsheet trigger event format**
- When trigger is "From spreadsheet" → "On form submit", the event object is different from a Form-based trigger:
  - `e.namedValues` — object with question titles as keys, arrays of string answers as values (e.g. `{"Full Name": ["John"], "Email ID": ["john@example.com"]}`)
  - `e.values` — flat array of values in column order
  - `e.range` — the range that was edited
- Current code uses `e.response.getItemResponses()` which only works with a Form-based trigger → **must rewrite to use `e.namedValues`**
- Use `e.namedValues` to map question titles → column keys via `FORM_FIELD_MAP` (same logic, different data access pattern)
- For `namedValues`, each value is an array (even for single answers), so use `value[0]` or `.join(", ")` for multi-select

**3. Update header comments**
- Remove standalone deployment instructions
- Add bound-script instructions:
  1. Open your Google Sheet
  2. Extensions → Apps Script
  3. Paste this code into Code.gs
  4. Update `SHARED_SECRET`
  5. Deploy as Web app (same settings)
  6. For Google Form trigger: Triggers → Add → `onFormSubmit`, From spreadsheet, On form submit

### File to modify
- `apps-script/sheets-proxy.js` — single file change

### Verification
1. Copy updated code into the bound Apps Script project (Extensions → Apps Script)
2. Deploy as web app → test React app form submission still works
3. Link Google Form to the spreadsheet (Form Responses tab → Sheets icon)
4. Add trigger: `onFormSubmit`, From spreadsheet, On form submit
5. Submit Google Form → verify row appears in Entries tab with `username=google-form`

---

## Duplicate Submission Prevention

### Problem
Users can submit the same event form multiple times. No deduplication exists anywhere in the pipeline.

### Approach: Client + Server (two layers)

**Layer 1 — Server-side (authoritative):** Check the `username` column in `doPost()` before appending. If the username already exists in that sheet tab, reject with `{ success: false, error: "duplicate", message: "..." }`.

**Layer 2 — Client-side (instant UX):** Track submissions in `localStorage`. On `FormPage` load, if the current user already submitted this form, show an "Already Registered" card instead of the form.

### Files to modify

#### 1. `apps-script/sheets-proxy.js` — Server-side duplicate check in `doPost()`

**Move lock earlier** to wrap both the check and the append as an atomic operation (prevents race condition where two tabs submit simultaneously):

```
doPost(e):
  parse data, validate secret, get sheet (same as now)

  lock = LockService.getScriptLock()
  lock.waitLock(10000)

  try:
    // DUPLICATE CHECK
    if username exists and username !== "google-form":
      find "username" column index from header row
      read all values in that column (single-column read, efficient)
      if username found → release lock, return { success: false, error: "duplicate", message: "You have already registered for this event." }

    // APPEND (same as current code)
    if sheet empty → append headers
    appendRow(values)
    lock.releaseLock()
    return { success: true, row: ... }
  catch:
    lock.releaseLock()
    return error
```

- Skip check for `username === "google-form"` (Google Form users can submit multiple times)
- Returns `error: "duplicate"` as machine-readable code + `message` as human-readable text

#### 2. `src/lib/google-sheets.ts` — Add `message` to response type

```typescript
interface SubmitResult {
  success: boolean;
  row?: number;
  error?: string;
  message?: string;  // NEW — human-readable error message from server
}
```

#### 3. `src/lib/storage.ts` — Add submission tracking methods

```typescript
markFormSubmitted(formId: string, username: string) {
  localStorage.setItem(`cac_submitted_${formId}`, JSON.stringify({ username, submittedAt: new Date().toISOString() }));
},

getFormSubmission(formId: string): { username: string; submittedAt: string } | null {
  const raw = localStorage.getItem(`cac_submitted_${formId}`);
  return raw ? JSON.parse(raw) : null;
},

clearFormSubmission(formId: string) {
  localStorage.removeItem(`cac_submitted_${formId}`);
},
```

Key is `cac_submitted_{formId}` (per form, not per user — same browser = same storage). Value stores username so we can verify it matches the logged-in user (handles user switching on same browser).

#### 4. `src/hooks/useFormSubmit.ts` — Use `message` field, expose `isDuplicate`

- Prefer `result.message` over `result.error` for display (human-readable)
- Add `isDuplicate: boolean` to state (set when `result.error === "duplicate"`)
- Return `isDuplicate` from hook

#### 5. `src/pages/FormPage.tsx` — Orchestration

**On load:** Check `storage.getFormSubmission(config.id)` — if it exists and `submission.username === user.username`, show an "Already Registered" card (reuse existing Card/Button components) instead of the form.

**After successful submit:** Call `storage.markFormSubmitted(config.id, user.username)` before navigating to success page.

**On server duplicate error:** Also call `storage.markFormSubmitted(config.id, user.username)` so subsequent visits show the card. The error Alert already displays the message.

### Edge cases
- **Two tabs submitting simultaneously:** Server lock prevents both from succeeding
- **localStorage cleared:** Server-side check still rejects; error marks localStorage for future visits
- **Different user on same browser:** `submission.username !== user.username` → form shown normally
- **Google Form submissions:** Excluded from server check (`"google-form"` username)

### Verification
1. Submit form → check Google Sheet has the row
2. Visit the same form page again → should see "Already Registered" card
3. Clear localStorage → visit form → form shown → click Submit → server rejects with "You have already registered"
4. Try submitting from two browser tabs simultaneously → only one succeeds

---

## Security Fix: Clear Stale User on Missing API Key

### Problem
The API key is stored in `sessionStorage` (cleared when browser closes), but the user object is stored in `localStorage` (persists forever). When a session expires or the browser is restarted:

1. `sessionStorage` API key is gone
2. `localStorage` user object remains — stale data sitting in storage
3. The mount effect in `AuthContext.tsx` sees `!apiKey` and sets `isLoading: false` but **doesn't clear the stale user from `localStorage`**

While this doesn't directly cause a vulnerability (nothing reads `storage.getUser()` into state without validating the API key first), it leaves stale PII in storage unnecessarily. If any future code were to read from `storage.getUser()` directly, it could trust stale/outdated profile data.

### Fix

**File: `src/context/AuthContext.tsx`** — In the mount `useEffect`, when no API key is found, also clear the stale user from `localStorage`:

```typescript
// Line 29-32: Change from:
const apiKey = storage.getApiKey();
if (!apiKey) {
  setState((s) => ({ ...s, isLoading: false }));
  return;
}

// To:
const apiKey = storage.getApiKey();
if (!apiKey) {
  storage.clearUser(); // Clean up stale user data
  setState((s) => ({ ...s, isLoading: false }));
  return;
}
```

Single line addition. No other files need changes.

### Verification
1. Log in → verify user data in localStorage and API key in sessionStorage
2. Close and reopen browser → sessionStorage cleared
3. Open app → should see login screen, and `localStorage` should no longer contain `cac_discourse_user`

---

## Verification

1. `npm run dev` — app starts on localhost:5173
2. Click "Login with Discourse" → redirects to Discourse, authorize, redirects back
3. Header shows logged-in user's name
4. Navigate to `/form/rsvp` as verified user → profile fields read-only, fill event fields, submit
5. Navigate to `/form/rsvp` as non-verified user → all fields editable
6. Check Google Sheet → row appended with correct data and column headers
7. Repeat for `/form/workshop`
8. Add a new form config entry → navigate to `/form/<new-id>` → form renders without code changes
9. Refresh page → session persists (API key in localStorage)
10. Logout → state clears, protected routes redirect to login
11. Submit Google Form → check RSVP tab has new row with `username=google-form`, `memberType=unverified`, and data in correct columns

---

## Targeted Notices via Vercel Serverless Function

### Context
Organisers need to post updates (e.g. meeting point, schedule change) visible only to members of a specific Discourse group. Content must not be in the JS bundle — a determined user reading the source should not be able to find the message. The notice appears on both the Home page and Form page.

### Approach
A Vercel serverless function (`api/notice.ts`) receives the user's Discourse API key, calls Discourse to verify group membership server-side, and returns the notice only if the user qualifies. Notice content is stored in Vercel environment variables (easy to update without redeployment). The JS bundle contains no message text and no group names.

### Architecture
```
Client                  Vercel Function          Discourse
  |                          |                       |
  |-- GET /api/notice ------>|                       |
  |   User-Api-Key: <key>    |                       |
  |   ?formId=star-party     |                       |
  |                          |-- GET /session/current.json -->|
  |                          |   User-Api-Key: <key>          |
  |                          |<-- { current_user: { groups } }|
  |                          |                       |
  |                          | check groups vs env var config
  |                          |                       |
  |<-- 200 { message, ... } -| (if in group)         |
  |<-- 403 Forbidden --------| (if not in group)     |
```

### Notice Schema
Each form can have **multiple notices** stored as a JSON array. A user sees a notice if they pass **all** configured conditions.

```typescript
interface NoticeConfig {
  id: string;           // Stable ID for dismissal tracking (e.g. "sp-mar26-meetpoint")
  title?: string;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
  type?: "info" | "warning" | "success"; // Alert style; default "info"
  dismissible?: boolean;                  // Show a close button; default false

  // Targeting — user must match at least one of groups OR usernames (if either is set)
  groups?: string[];       // Discourse group names
  usernames?: string[];    // Specific Discourse usernames
  minTrustLevel?: number;  // Discourse trust level >= this (0–4)

  // Time window — both evaluated server-side (avoids client clock manipulation)
  activeFrom?: string;  // ISO datetime; notice hidden before this
  activeUntil?: string; // ISO datetime; notice hidden after this
}
```

### Environment Variables (set in Vercel dashboard)
One env var per form, containing a **JSON array** of notice objects:

```
NOTICE_STAR_PARTY_MARCH_2026=[
  {
    "id": "sp-mar26-meetpoint",
    "groups": ["star-party-registered"],
    "title": "Meeting point update",
    "message": "Meet at the main gate at 6:30 PM. Bring warm clothing.",
    "linkUrl": "https://chat.whatsapp.com/...",
    "linkLabel": "Join the WhatsApp group",
    "dismissible": true,
    "activeFrom": "2026-03-05T00:00:00Z"
  },
  {
    "id": "sp-mar26-vip",
    "usernames": ["telescope_owner"],
    "message": "Your telescope spot at Pad 3 has been reserved.",
    "type": "success"
  }
]
```

To update: edit env var in Vercel → redeploy. To disable all: remove the env var.

### Files to Create / Modify

#### 1. `api/notice.ts` (NEW — Vercel serverless function)
Fetches user data from Discourse, filters the notices array down to those the user qualifies for, and returns them. Targeting fields (`groups`, `usernames`, `minTrustLevel`) and time windows (`activeFrom`/`activeUntil`) are evaluated server-side and stripped from the response.

Logic per notice:
- If `groups` or `usernames` set → user must be in at least one group OR username must match
- If `minTrustLevel` set → user's trust level must be >=
- If `activeFrom`/`activeUntil` set → current server time must be within the window
- All conditions that are set must pass (AND logic between condition types)

Returns: array of notices the user qualifies for (targeting fields stripped). Empty array → no notices shown. 401 if no API key. 500 if Discourse call fails.

#### 2. `src/hooks/useNotice.ts` (NEW)
```typescript
import { useState, useEffect } from "react";
import { storage } from "@/lib/storage";

export interface Notice {
  id: string;
  title?: string;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
  type?: "info" | "warning" | "success";
  dismissible?: boolean;
}

export function useNotices(formId: string, isAuthenticated: boolean): Notice[] {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const apiKey = storage.getApiKey();
    if (!apiKey) return;

    fetch(`/api/notice?formId=${encodeURIComponent(formId)}`, {
      headers: { "User-Api-Key": apiKey },
    })
      .then(res => (res.ok ? res.json() : []))
      .then(data => setNotices(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [formId, isAuthenticated]);

  return notices;
}
```

#### 3. `src/components/notices/NoticeAlert.tsx` (NEW — reusable)
Renders all applicable notices for a form. Handles dismissal via localStorage keyed by `notice.id`.

```tsx
import { useState } from "react";
import { useNotices } from "@/hooks/useNotice";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { X } from "lucide-react";

const DISMISSED_KEY = "cac_dismissed_notices";

function getDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); }
  catch { return []; }
}

function dismiss(id: string) {
  const current = getDismissed();
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...current, id])]));
}

export function NoticeAlert({ formId }: { formId: string }) {
  const { isAuthenticated } = useAuth();
  const notices = useNotices(formId, isAuthenticated);
  const [dismissed, setDismissed] = useState<string[]>(getDismissed);

  const visible = notices.filter(n => !dismissed.includes(n.id));
  if (!visible.length) return null;

  return (
    <div className="space-y-2">
      {visible.map(notice => (
        <Alert key={notice.id} variant={notice.type === "warning" ? "destructive" : "default"}>
          <div className="flex items-start justify-between gap-2">
            <div>
              {notice.title && <AlertTitle>{notice.title}</AlertTitle>}
              <AlertDescription>
                {notice.message}
                {notice.linkUrl && (
                  <a href={notice.linkUrl} target="_blank" rel="noopener noreferrer" className="ml-2 underline">
                    {notice.linkLabel ?? "Learn more"}
                  </a>
                )}
              </AlertDescription>
            </div>
            {notice.dismissible && (
              <button onClick={() => { dismiss(notice.id); setDismissed(getDismissed()); }}
                className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </Alert>
      ))}
    </div>
  );
}
```

#### 4. `src/pages/HomePage.tsx`
Add `<NoticeAlert formId={form.id} />` below the Register button inside each form's Card.

#### 5. `src/pages/FormPage.tsx`
Add `<NoticeAlert formId={config.id} />` at the top of the page content, above the form/already-registered card.

#### 4. `src/pages/HomePage.tsx` and `src/pages/FormPage.tsx`
Add `<NoticeAlert formId={form.id} />` — below the Register button in HomePage's Card, and at the top of FormPage content.

#### 5. `src/App.tsx`
Add `/admin` route pointing to `AdminPage`.

---

## Email Notifications to Group Members

### Context
When an organiser publishes a notice, they want to proactively email group members rather than waiting for them to check the app. Emails are sent to Discourse group members (same targeting as the notice). Triggered from a protected admin page in the app.

### New Environment Variables (Vercel)
```
RESEND_API_KEY=re_...                      # From resend.com dashboard
DISCOURSE_ADMIN_API_KEY=<key>              # Discourse admin API key (Admin → API)
DISCOURSE_ADMIN_USERNAME=<username>        # Discourse admin username (for group member lookup)
```
No `ADMIN_SECRET` needed — access is controlled by the user's Discourse admin status, verified server-side.
Server-only vars (no `VITE_` prefix — never bundled into client JS): `RESEND_API_KEY`, `DISCOURSE_ADMIN_API_KEY`, `DISCOURSE_ADMIN_USERNAME`.

### Files to Create / Modify

#### 6. `api/send-notice.ts` (NEW — Vercel serverless function)
```
POST /api/send-notice
Body: { formId }
Headers: User-Api-Key: <user's discourse api key>
```

Logic:
1. Call `GET /session/current.json` with the `User-Api-Key` header → verify `current_user.admin === true` → 403 if not
2. Read `NOTICE_<FORM_ID>` env var → 404 if not set
3. For each group name in the notice config:
   - Call `GET /groups/{name}/members.json` with Discourse admin API key (paginated, up to 1000 members)
   - Collect `{ email, username, name }` per member
4. Merge with any `usernames` targets (if set) — fetch their profiles via `GET /u/{username}.json`
5. Deduplicate emails
6. Build email HTML from notice `title`, `message`, `linkUrl`
7. Send via Resend batch API (`POST https://api.resend.com/emails/batch`, max 100 per batch)
8. Return `{ sent: N, failed: M }`

#### 7. `src/types/discourse.ts`
Add `admin?: boolean` to `DiscourseUser` (already returned by `/session/current.json`, just not typed).

#### 8. `src/pages/AdminPage.tsx` (NEW)
Protected page at `/admin`. Uses the existing `useAuth()` hook — if the user is not logged in or `user.admin !== true`, shows an "Access denied" message. No password input needed.

```tsx
export function AdminPage() {
  const { isAuthenticated, user, isLoading } = useAuth();
  const [results, setResults] = useState<Record<string, string>>({});

  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <p>Please log in.</p>;
  if (!user?.admin) return <p>Access denied. Requires Discourse admin.</p>;

  return (
    <div>
      <h1>Admin — Send Notifications</h1>
      {formConfigs.map(form => (
        <Card key={form.id}>
          <CardHeader><CardTitle>{form.title}</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => sendNotice(form.id, setResults)}>
              Send Email Notification
            </Button>
            {results[form.id] && <p>{results[form.id]}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function sendNotice(formId: string, setResults: ...) {
  const apiKey = storage.getApiKey();
  const res = await fetch("/api/send-notice", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Api-Key": apiKey! },
    body: JSON.stringify({ formId }),
  });
  const data = await res.json();
  setResults(r => ({ ...r, [formId]: res.ok ? `Sent to ${data.sent}` : data.error }));
}
```

### Setup Steps
1. Sign up at [resend.com](https://resend.com), verify your domain, copy API key
2. In Discourse: Admin → API → Generate Global API Key (admin scope) → copy key and admin username
3. Add env vars in Vercel: `RESEND_API_KEY`, `DISCOURSE_ADMIN_API_KEY`, `DISCOURSE_ADMIN_USERNAME`, `NOTICE_<FORM_ID>`
4. `npm install -D @vercel/node` — TypeScript types for Vercel functions
5. Create a Discourse group (e.g. `star-party-registered`), add registered users
6. Add `/admin` route to `src/App.tsx`
7. Redeploy

### Verification
**Notices (read-only):**
1. Log in as a group member → notice appears on Home and Form pages
2. Log in as non-member → no notice
3. Log out → no notice
4. Set `dismissible: true` → close button appears; closing persists across page refreshes
5. Set `activeUntil` to a past date → notice disappears automatically

**Email sending:**
1. Log in as a Discourse admin → navigate to `/admin` → page loads (no password needed)
2. Log in as a non-admin → `/admin` shows "Access denied"
3. Click "Send Email Notification" for a form
4. API verifies admin status via Discourse, fetches group members, sends via Resend
5. Returns `{ sent: N, failed: 0 }` → shown on the page
6. Check Resend dashboard → emails logged with delivery status
7. Check inbox (as a group member) → email received
