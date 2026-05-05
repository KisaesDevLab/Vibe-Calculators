# Tax calculators

Each calculator is a self-contained form-and-narrative tool. Inputs are
validated by Zod at submit time; outputs are computed deterministically
against the persisted tax-year tables so results reproduce exactly when
re-run later.

## TVM specialty templates

These are accessed from the workbench but invoke specialized
calc-engine functions for cleaner numbers.

| Template               | What it computes                                                      |
| ---------------------- | --------------------------------------------------------------------- |
| Bond price + YTM       | Clean / dirty price, accrued interest; or yield given price.          |
| ASC 842 lease PV       | Right-of-use asset present value, monthly amortization.               |
| IRR / NPV              | Newton-Raphson IRR, NPV at user-supplied discount, MIRR.              |
| Sinking fund           | Required periodic deposit to reach a future value.                    |
| TDR PV impairment      | Restructured cash-flow PV at original rate; impairment delta.         |
| §7872 imputed interest | Below-market loan: foregone interest, OID, term/demand variants.      |
| Lease rate factor      | Rate-factor + implicit rate from equipment cost / payment / residual. |
| Note buy/sell yield    | Yield to a buyer who purchases an existing note at a discount.        |

## Tax calculators

### Depreciation & cost recovery

- **MACRS** — Half-year, mid-quarter, mid-month conventions; recovery
  periods 3, 5, 7, 10, 15, 20, 25, 27.5, 39 years; bonus depreciation
  per the §168(k) phase-out table; §179 election with phase-out;
  alt-depreciation system (ADS) for qualifying property.
- **Section 179** — current-year deduction with phase-out, SUV cap,
  carryforward of disallowed amount.
- **Bonus depreciation** — IRC §168(k) phase-out (40% for 2025) plus the
  OBBBA mid-year reinstatement to 100% for property placed in service
  on/after 2025-01-20.

### Retirement & investment

- **RMD** — Uniform Lifetime, Joint Life (spouse 10+ years younger),
  Single Life. SECURE 2.0 starting age (73 in 2023, 75 in 2033).
- **Roth conversion** — single-year analysis: marginal tax cost vs.
  long-run tax-free growth.
- **Form 8606 nondeductible IRA** — basis tracking, pro-rata rule for
  distributions.

### Income & payroll

- **Federal income tax** — bracket walk for the supplied year, std
  deduction or itemized, addt'l Medicare, NIIT.
- **QBI (§199A)** — basic + W-2-wage-and-UBIA phase-out, SSTB cliff.
- **AMT (Form 6251)** — exemption with phase-out; preferences and
  adjustments; AMT credit carryforward.
- **NIIT (Form 8960)** — 3.8% surtax on net investment income above
  threshold.
- **FICA / Medicare (W-4 2020+)** — employer/employee withholding,
  wage-base cap, addt'l Medicare 0.9%.
- **Self-employment tax** — Schedule SE, both halves, deduction
  half-of-SE.
- **Quarterly estimated tax (Form 1040-ES)** — safe-harbor (110% prior
  year for high earners), evenly-spaced and annualized methods.

### Tax-advisory

- **§1031 exchange** — boot, basis transfer, depreciation recapture.
- **§1411 NIIT vs §199A interaction** — surfaces both numbers.
- **IRS underpayment / overpayment interest** — quarterly compounding
  per IRC §6621 + AFR-short rate sheet.
- **Form 4972 lump-sum distribution** — 10-year averaging.
- **Form 8915 disaster distribution** — three-year ratable inclusion.
- **AMT credit carryforward** — Form 8801 trace.
- **Optimal Social Security claim age** — break-even analysis between
  62 / FRA / 70.

### Forms-coverage scope

Math is benchmarked against worked examples in:

- IRS Pub 17 (federal individual income tax)
- IRS Pub 535 (business expenses)
- IRS Pub 550 (investment income)
- IRS Pub 590-B (RMD)
- IRS Pub 946 (depreciation)
- Forms 1040-ES, 4562, 4972, 6251, 8606, 8915, 8960, 8995/8995-A
- Form W-4 (2020+) employer withholding tables

## Tax-year reproducibility

Every tax calculation persists the IDs of the rate-table rows it
consumed. Re-running a 2024 calculation in 2026 produces the identical
2024 result, regardless of which tables have been published since.

The mid-year override mechanism (e.g. OBBBA bonus depreciation) sits in
a separate `tax_year_overrides` table that the resolver checks before
falling back to the seed values. Operators see both at
**Admin → Tax tables**.

## Where rate tables come from

| Year | Source                                                                                     |
| ---- | ------------------------------------------------------------------------------------------ |
| 2023 | Rev. Proc. 2022-38; SSA fact sheet; Rev. Proc. 2022-24 (HSA); Notice 2022-55 (retirement). |
| 2024 | Rev. Proc. 2023-34; SSA fact sheet; Rev. Proc. 2023-23 (HSA); Notice 2023-75.              |
| 2025 | Rev. Proc. 2024-40; SSA fact sheet; Rev. Proc. 2024-25 (HSA); Notice 2024-80.              |

Source URLs are linked from each row in the **Admin → Tax tables**
browser.
