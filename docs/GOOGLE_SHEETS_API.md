# Google Sheets API (registrations backend)

Registration actions (`reserve`, `status`, `submit`, etc.) run on Vercel via the **Google Sheets API** (no Apps Script web app).

## Setup

1. **Google Cloud Console** → create a project → enable **Google Sheets API**.
2. **IAM** → Service Accounts → Create → download JSON key.
3. Open your registration spreadsheet → **Share** → add the service account email as **Editor**.
4. Copy the spreadsheet ID from the URL:  
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
5. In **Vercel** (and local `.env` for `vercel dev`), set:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...entire json on one line...}
```

Or use split vars (useful when the private key has newlines):

```env
GOOGLE_CLIENT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

6. Redeploy. `/api/registrations` requires these vars.

## Apps Script (optional)

`apps-script/sheets-proxy.js` is only needed for **Google Form** triggers (`onFormSubmit`). The React app talks directly to `/api/registrations` → Sheets API.

## Concurrency

Writes are serialized per sheet tab on each serverless instance. New rows use `values.append` (atomic). Holds are released and duplicates resolved by marking rows `Expired` (rows are never physically deleted), so row indices stay stable under parallel requests.
