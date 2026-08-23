const THREE_DECIMAL = new Set(['KWD', 'BHD', 'OMR', 'JOD'])

export const currencyDecimals = (currency: string) =>
  THREE_DECIMAL.has(currency?.toUpperCase()) ? 3 : 2

export const roundForCurrency = (amount: number, currency: string) => {
  const factor = 10 ** currencyDecimals(currency)
  return Math.round(amount * factor) / factor
}

export const formatMoney = (amount: number, currency: string, locale = 'en-US') => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: currencyDecimals(currency),
      maximumFractionDigits: currencyDecimals(currency)
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(currencyDecimals(currency))}`
  }
}
