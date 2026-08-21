/**
 * The currencies a Quote may be entered in.
 *
 * Deliberately not `server-only`: the picker on the add-quote form and the check that
 * refuses a price on the server read the same list, and a picker offering a currency the
 * server will reject is a refusal nobody could have avoided.
 *
 * ## Why the list is written down rather than fetched
 *
 * Frankfurter serves it at `/v1/currencies`, and asking for it would make rendering the
 * form depend on a service being up — which is exactly the dependency the frozen rate
 * exists to remove. It is also the ECB reference list, which changes about once a
 * decade: the last additions were 2018. A currency ECB starts publishing shows up here
 * in a one-line commit, and until then a supplier quoting it is refused at entry with a
 * sentence, rather than stored as a price nothing can convert (buildspec_2.md A11).
 *
 * Verified against `https://api.frankfurter.dev/v1/currencies` on 2026-08-21.
 */

/** The one currency every comparison and every dashboard figure is shown in. */
export const reportingCurrency = "THB";

/**
 * The thirty currencies ECB publishes a reference rate for, THB among them.
 *
 * THB is in the set on its own terms — it is an ECB reference currency — but nothing
 * ever fetches a rate for it, because a THB quote is not converted at all.
 */
export const convertibleCurrencies = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK",
  "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const;

const convertible = new Set<string>(convertibleCurrencies);

export function isConvertibleCurrency(currency: string): boolean {
  return convertible.has(currency);
}

/**
 * The order the picker offers them in: the three seen in real data first, then the rest
 * alphabetically.
 *
 * THB leads because most quotes are in it, and a Baht price entered as Dollars by a
 * mis-tapped default is off by a factor of thirty-three in the one direction that makes
 * a Bid look cheap.
 */
export const currencyOptions = [
  reportingCurrency,
  "CNY",
  "USD",
  ...convertibleCurrencies.filter(
    (currency) => !["THB", "CNY", "USD"].includes(currency),
  ),
];
