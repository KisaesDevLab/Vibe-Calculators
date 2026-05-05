# Glossary

Quick definitions for terms used throughout the appliance.

## Financial / TVM

**APR** — Annual Percentage Rate. The "all-in" cost of credit
expressed as an annualized rate, including finance charges (Reg Z
mandatory disclosure).

**AFR** — Applicable Federal Rate. IRS-published minimum interest
rate for related-party loans to avoid imputed-interest treatment.
Three terms: short (≤3 yr), mid (3–9 yr), long (>9 yr). Updated
monthly.

**ACH / EFT** — Automated Clearing House / Electronic Funds Transfer.
Out of scope for this appliance — we model schedules, not move
real money.

**Amortization** — Allocating a loan's payments between interest and
principal over time. Standard formula:
`P = L × r / (1 − (1 + r)^−n)`.

**ASC 842** — FASB Accounting Standards Codification topic 842,
"Leases." All leases > 12 months are capitalized on the balance
sheet at right-of-use asset value.

**Balloon** — A large, single payment at the end of a loan that
covers the remaining principal not amortized through periodic
payments.

**Bonus depreciation** — IRC §168(k) accelerated first-year
deduction for qualifying property. Phasing out: 80% in 2023, 60% in
2024, 40% in 2025 (with OBBBA mid-year override to 100%), 20% in
2026, 0% in 2027.

**Compounding interval** — How often interest is calculated and
added to principal: monthly, quarterly, semi-annually, annually,
daily, continuous.

**Day-count convention** — How year-fractions are computed.
30/360 treats every month as 30 days (banker's year). ACT/365 uses
actual days / 365. Different conventions produce different
interest accruals.

**Effective rate** — The actual annualized return after compounding.
For a quoted nominal rate of 6% compounded monthly, the effective
rate is `(1 + 0.06/12)^12 − 1 ≈ 6.17%`.

**HELOC** — Home Equity Line of Credit. Revolving credit secured by
home equity, draw period followed by repayment period.

**IRR** — Internal Rate of Return. The discount rate that makes the
NPV of a cash-flow stream zero.

**MIRR** — Modified IRR. Same as IRR but uses an explicit
re-investment rate for positive flows and a finance rate for
negative flows. More realistic for capital-budgeting decisions.

**NPV** — Net Present Value. Sum of cash flows discounted at a
specified rate, expressed in today's dollars.

**OID** — Original Issue Discount. The difference between a debt
instrument's stated principal and its issue price; treated as
interest for tax purposes.

**RMD** — Required Minimum Distribution. Annual minimum withdrawal
from tax-deferred retirement accounts after age 73 (post-SECURE 2.0)
or 75 (after 2033). Life-expectancy tables: Uniform Lifetime, Joint
Life, Single Life.

**Roth conversion** — Moving traditional-IRA money into a Roth IRA.
Pay tax on the converted amount today; future growth + qualified
distributions are tax-free.

**Rule of 78** — Sum-of-digits front-loading of finance charges.
Total interest matches normal amortization but is allocated more
heavily to early periods. Used in some short-term consumer credit.

**SBA 7(a)** — Small Business Administration's flagship loan
program. Variable-rate (Prime + spread), 7- to 25-year terms.

**TDR** — Troubled Debt Restructuring (ASC 310-40). Lender concedes
something to a financially-troubled borrower; impairment is
measured as carrying value − PV of restructured cash flows at
the original effective rate.

**TIPRA / OBBBA** — Tax Increase Prevention and Reconciliation Act
(2005) / One Big Beautiful Bill Act (2025). Generic legislative
acronyms; the appliance uses OBBBA in its mid-year override notes
for 100% bonus depreciation reinstatement on/after 2025-01-20.

**TILA** — Truth in Lending Act. Federal consumer-credit disclosure
statute. The Reg Z PDF template implements the standard "Statement
of Loan Cost" disclosures TILA requires.

**TValue** — Industry-standard TVM software. The appliance benchmarks
its math against TValue 6 cents-level. **TValue is a trademark of
TimeValue Software**; the appliance is not affiliated.

**USRule** — Simple-interest accrual with NO capitalization of unpaid
interest. Common in older consumer credit; "no negative
amortization."

**YTM** — Yield to Maturity. The IRR on a bond's cash flows
(coupons + maturity payment) given today's price.

## Tax

**AGI / MAGI** — Adjusted Gross Income / Modified AGI. Federal income
tax computation starting points. MAGI adds back specific items
depending on the deduction or credit.

**AMT** — Alternative Minimum Tax (Form 6251). Parallel tax
calculation on a broader income base; taxpayer pays the higher of
regular tax and AMT.

**FICA** — Federal Insurance Contributions Act. OASDI (Social
Security, 6.2%) + Medicare (1.45%). Additional Medicare 0.9% on
wages above threshold.

**MACRS** — Modified Accelerated Cost Recovery System. The federal
depreciation system since 1986. Property is assigned a class life
(3, 5, 7, 10, 15, 20, 25, 27.5, 39 years) and depreciated using
declining-balance switching to straight-line.

**NIIT** — Net Investment Income Tax (Form 8960). 3.8% surtax on net
investment income above $200k single / $250k MFJ thresholds (fixed
by IRC, not indexed).

**QBI** — Qualified Business Income deduction (§199A). 20% deduction
for pass-through business income, with phase-outs based on
taxable income, W-2 wages, and unadjusted basis of qualifying
property.

**Schedule SE** — Self-Employment tax (15.3% combined OASDI +
Medicare). Computed on 92.35% of net SE income; half is deductible
above the line.

**SECURE Act / SECURE 2.0** — Setting Every Community Up for
Retirement Enhancement Act. Original (2019) and 2.0 (2022). Changes
to RMD age, IRA contribution rules, beneficiary distribution
periods.

**§179** — IRC §179 election. Current-year deduction (vs. depreciation)
for qualifying property up to a cap (2024: $1.16M), with phase-out
above $2.89M of property placed in service.

**§7872** — Below-market loan rules. Requires imputed interest at the
AFR when stated rate is below AFR; characterizes the foregone
interest as a compensation, gift, or contribution depending on
relationship.

## Operations / appliance

**BullMQ** — Redis-backed Node.js job queue. Powers the export,
webhook, and scheduler workers.

**Caddy** — HTTP/2 + auto-HTTPS reverse proxy serving as the
appliance's sole ingress.

**distroless** — Google's minimal container base image: just the
runtime (Node), no shell, no package manager, no curl.

**Drizzle** — TypeScript-first ORM. Powers schema + migrations.

**KMS** — Key Management System. The appliance's `VIBE_KMS_KEY` is
the master key for envelope-encrypting TOTP secrets, API keys,
webhook secrets.

**TOTP** — Time-based One-Time Password (RFC 6238). Standard 2FA
mechanism — Google Authenticator, 1Password, Bitwarden, et al. all
implement it.
