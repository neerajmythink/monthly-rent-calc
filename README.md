# Monthly Rental Expense Calculator

This is a client-only Vite + React + TypeScript application for calculating and tracking monthly rental expenses in India. It has no backend, database, authentication, or browser storage. Settings and bills exist only in React memory and are cleared when you refresh or close the page.

## Local development

1. Install dependencies:
   npm install
2. Start the app:
   npm run dev
3. Run tests:
   npm run test
4. Build for production:
   npm run build

## Rent calculation

The bill uses the base monthly rent entered for the selected billing month. The PDF bill is generated in the browser and downloaded to the device; it does not require a backend or store data after the page is refreshed.

## Deployment

The static production build can be hosted on Vercel or any static web host. No environment variables are required.
