# Fieldnote

A local-first quote and invoice maker for tradespeople. Open `index.html` in a modern browser, or serve this folder with any static web server.

## Using the app

The public homepage opens first. Select **Pricing** to see plans on a separate view, or **Try the local workspace** to access the documents already saved in this browser. Use **Home** in the workspace header to return. The **Sign up** and **Log in** buttons show non-functional account-screen previews: their fields are disabled and they do not collect credentials.

1. Open **Business settings** to add your business details, optional logo, and preferred currency. The currency is the default for new documents and saved services; existing documents retain their own currency.
2. Save frequently used customers and services using the navigation, then select them when creating a document. Details copied into a document do not change if the saved customer or service is edited later.
3. Create a quote or invoice, select one of five designs, add a customer and line items, and save it. You can upload or remove your logo in the editor; saving updates the business logo used on all documents. Add an optional fixed or percentage discount before tax, payment terms, and a deposit **already received**. Ontario HST at 13% is enabled by default and can be turned off per document. Confirm whether HST applies to your business and the work being billed, especially when using another currency.
4. Open a quote and select **Create invoice** to copy it into a new draft invoice. The original quote remains unchanged. Review the copied deposit and set an invoice due date before saving.
5. In the document preview, use **Save JPEG** to download an image, or **Print / save PDF** and select your browser's PDF destination. Very long documents may need to be saved as PDF instead of JPEG.
6. **Share details** opens your device's share sheet where supported, otherwise it opens an SMS app when a phone number is present or copies the details when clipboard access is available. Attach the saved PDF separately. Sharing does not automatically change the document's status.
7. Export a JSON backup from **Business settings** and keep it somewhere safe. Restoring a backup replaces the current local workspace; export it first if you need to keep it. Backup files contain customer and business information, so protect them accordingly.

To combine existing quotes and invoices, open **Documents**, select **Combine into PDF**, choose the documents, and select **Print / save PDF**. Choose your browser's PDF destination to save them in one file. Each document starts on a new page; a lengthy document may span multiple pages.

Statuses are updated manually. Dashboard outstanding and overdue amounts include invoices marked sent, less deposits received; overdue means the due date is before today. Quotes awaiting approval are quotes marked sent.

Currency selection supports the currencies provided by the browser's internationalization data, including currencies with zero or three decimal places. Changing currency does not perform exchange-rate conversion. Saved services can only be added to documents using the same currency. Dashboard totals are separated by currency rather than converted or combined.

The local free plan permits five new quotes and five new invoices per calendar month, based on the device's local date. Converting a quote creates an invoice and counts toward the invoice limit; editing or deleting a document does not refund or consume a slot. Usage tracking starts with this feature, so existing documents are not counted retroactively. Backup files include usage; restoring a backup keeps the higher count already recorded on this device. These limits are a local prototype and can be bypassed by clearing browser data or changing devices. Free documents include “Created with Fieldnote” in previews, PDFs, and JPEGs. The proposed $12 CAD/month unlimited upgrade is not active.

## Local-first limitations

Documents and the business logo are saved in the current browser's local storage. They do not sync across browsers or devices and may be lost if browser data is cleared. JSON export is a manual backup, not automatic cloud backup. The ad spaces are placeholders, not live Google or custom ads. This version has no account, hosted approval links, automatic email or SMS delivery, scheduled reminders, Stripe payments, subscriptions, or tamper-resistant usage enforcement. Those capabilities require a hosted backend and configured service accounts.

The public homepage and pricing view have a header slot and three footer slots. The workspace also has a header, three footer slots, and two sidebar slots below the workspace menu. These are labeled placeholders for future ads; the sidebar slots appear on viewports at least 600 pixels wide. No ad network or custom-ad management is connected.

## Future Supabase setup

The app is not connected to Supabase, and the account previews cannot create or authenticate users. To add real accounts and cloud sync later:

1. In your Supabase project, enable email authentication and configure the site URL and allowed redirect URLs for your hosted site (and localhost for development). Review the email confirmation and password recovery settings.
2. Obtain the project URL and **publishable** (or legacy **anon**) key from the project's API settings. These are intended for browser use. Never put a secret key, service-role key, database password, or other privileged credential in client-side code.
3. Implement sign-up, login, logout, session handling, and confirmation/recovery redirects using the [Supabase authentication documentation](https://supabase.com/docs/guides/auth).
4. Create cloud storage with ownership-based row-level security so authenticated users can only access their own records. Add safe handling for failed saves and concurrent edits before enabling sync. See the [row-level security guide](https://supabase.com/docs/guides/database/postgres/row-level-security).
5. Provide an explicit, non-destructive way to import the existing browser workspace after sign-in; do not silently upload or overwrite it. Test account isolation, confirmation, logout, failure recovery, and access on a second device before launching.
