# Amortize In-Progress — Remaining Loan Calculator

A standalone, no-build web application designed specifically for loans where the borrower has already started making payments. Open `index.html` in any browser.

## Features

- **In-Progress Loan Inputs**:
  - **Current Loan Balance**: Outstanding principal amount.
  - **Monthly Payment (P&I)**: Regular principal and interest payment.
  - **Months Remaining**: Remaining payoff duration with instant year/month breakdown (e.g., 20 yrs 0 mo).
  - **Next Payment Month**: Start date for future amortization payments.
  - **Payments Made So Far (Optional)**: Preserves overall loan context (e.g. tracks Payment #1 as Loan Payment #61).
- **Automatic Implied Interest Rate Calculation**: Uses binary search to solve for the exact implied interest rate (APR) when balance, payment, and remaining months are provided.
- **Flexible Calculation Modes**:
  - **Solve Rate** *(Default)*: Computes APR from current balance, payment, and remaining months.
  - **Solve Payment**: Computes monthly payment from current balance, interest rate, and remaining months.
  - **Solve Months**: Computes remaining months from current balance, interest rate, and payment.
- **Payoff Strategy & Accelerated Amortization**: Test extra monthly payments with a configurable start month.
- **Investment Tradeoff Analysis**: Compare paying down extra principal versus investing the difference (with expected returns and capital gains tax).
- **Interactive Balance Trajectory Chart**: High-resolution Canvas chart comparing the standard remaining balance payoff, your accelerated payoff strategy, and the investing scenario.
- **Payment Ledger & CSV Export**: Complete monthly table showing payment numbers, dates, principal, interest, extra payments, and remaining balance, filterable by year, with one-click CSV export.
- **Presets & Local Persistence**: Includes Home, Auto, and Personal loan presets, with automatic LocalStorage saving and instant reset.
