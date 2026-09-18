/**
 * Every currency a store may trade in: the ISO 4217 codes in circulation today,
 * without the fund codes, precious metals and currencies that have been
 * withdrawn (BGN, HRK, ANG, SLL, ZWL …).
 *
 * A list rather than 'any three letters', because the code is printed beside
 * every price the shop shows and a typo in it is not an error anywhere — `Intl`
 * formats an unknown code as the code itself, so `BTD 1,299` would run on every
 * card and receipt until somebody happened to notice.
 *
 * The names and narrow symbols were generated once from ICU 78 and are written
 * down rather than asked of `Intl` at render time: ICU is not the same build in
 * Node and in every browser, and a symbol that differed between the server
 * render and hydration would be a mismatch on the settings screen. `symbol` is
 * null where ICU has nothing shorter than the code.
 *
 * **A deliberate copy** — `client-admin/src/lib/currencies.ts` draws the picker
 * from the same list this API validates against. Change them together.
 */
export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string | null;
}

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'AED', name: 'United Arab Emirates Dirham', symbol: null },
  { code: 'AFN', name: 'Afghan Afghani', symbol: '؋' },
  { code: 'ALL', name: 'Albanian Lek', symbol: null },
  { code: 'AMD', name: 'Armenian Dram', symbol: '֏' },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
  { code: 'AWG', name: 'Aruban Florin', symbol: null },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM' },
  { code: 'BBD', name: 'Barbadian Dollar', symbol: '$' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: null },
  { code: 'BIF', name: 'Burundian Franc', symbol: null },
  { code: 'BMD', name: 'Bermudan Dollar', symbol: '$' },
  { code: 'BND', name: 'Brunei Dollar', symbol: '$' },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'BSD', name: 'Bahamian Dollar', symbol: '$' },
  { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: null },
  { code: 'BWP', name: 'Botswanan Pula', symbol: 'P' },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: null },
  { code: 'BZD', name: 'Belize Dollar', symbol: '$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'CDF', name: 'Congolese Franc', symbol: null },
  { code: 'CHF', name: 'Swiss Franc', symbol: null },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$' },
  { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
  { code: 'CUP', name: 'Cuban Peso', symbol: '$' },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: null },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: null },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'DOP', name: 'Dominican Peso', symbol: '$' },
  { code: 'DZD', name: 'Algerian Dinar', symbol: null },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: null },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: null },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'FJD', name: 'Fijian Dollar', symbol: '$' },
  { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'GIP', name: 'Gibraltar Pound', symbol: '£' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: null },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG' },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q' },
  { code: 'GYD', name: 'Guyanaese Dollar', symbol: '$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: '$' },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L' },
  { code: 'HTG', name: 'Haitian Gourde', symbol: null },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: null },
  { code: 'IRR', name: 'Iranian Rial', symbol: null },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr' },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: '$' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: null },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: null },
  { code: 'KGS', name: 'Kyrgyz Som', symbol: null },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF' },
  { code: 'KPW', name: 'North Korean Won', symbol: '₩' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: null },
  { code: 'KYD', name: 'Cayman Islands Dollar', symbol: '$' },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸' },
  { code: 'LAK', name: 'Laotian Kip', symbol: '₭' },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'L£' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'LRD', name: 'Liberian Dollar', symbol: '$' },
  { code: 'LSL', name: 'Lesotho Loti', symbol: null },
  { code: 'LYD', name: 'Libyan Dinar', symbol: null },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: null },
  { code: 'MDL', name: 'Moldovan Leu', symbol: null },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
  { code: 'MKD', name: 'Macedonian Denar', symbol: null },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
  { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮' },
  { code: 'MOP', name: 'Macanese Pataca', symbol: null },
  { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: null },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: 'Rs' },
  { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: null },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: null },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'MZN', name: 'Mozambican Metical', symbol: null },
  { code: 'NAD', name: 'Namibian Dollar', symbol: '$' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
  { code: 'OMR', name: 'Omani Rial', symbol: null },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: null },
  { code: 'PEN', name: 'Peruvian Sol', symbol: null },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: null },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'Rs' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'PYG', name: 'Paraguayan Guarani', symbol: '₲' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: null },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
  { code: 'RSD', name: 'Serbian Dinar', symbol: null },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'RF' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: null },
  { code: 'SBD', name: 'Solomon Islands Dollar', symbol: '$' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: null },
  { code: 'SDG', name: 'Sudanese Pound', symbol: null },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: '$' },
  { code: 'SHP', name: 'St. Helena Pound', symbol: '£' },
  { code: 'SLE', name: 'Sierra Leonean Leone', symbol: null },
  { code: 'SOS', name: 'Somali Shilling', symbol: null },
  { code: 'SRD', name: 'Surinamese Dollar', symbol: '$' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: '£' },
  { code: 'STN', name: 'São Tomé & Príncipe Dobra', symbol: 'Db' },
  { code: 'SYP', name: 'Syrian Pound', symbol: '£' },
  { code: 'SZL', name: 'Swazi Lilangeni', symbol: null },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'TJS', name: 'Tajikistani Somoni', symbol: null },
  { code: 'TMT', name: 'Turkmenistani Manat', symbol: null },
  { code: 'TND', name: 'Tunisian Dinar', symbol: null },
  { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'TTD', name: 'Trinidad & Tobago Dollar', symbol: '$' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: '$' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: null },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: null },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$' },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: null },
  { code: 'VES', name: 'Venezuelan Bolívar', symbol: null },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'VUV', name: 'Vanuatu Vatu', symbol: null },
  { code: 'WST', name: 'Samoan Tala', symbol: null },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA' },
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: '$' },
  { code: 'XCG', name: 'Caribbean Guilder', symbol: 'Cg.' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'F CFA' },
  { code: 'XPF', name: 'CFP Franc', symbol: 'CFPF' },
  { code: 'YER', name: 'Yemeni Rial', symbol: null },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
  { code: 'ZWG', name: 'Zimbabwean Gold', symbol: null },
];

/**
 * Offered above the full list, in this order. The platform sells into
 * Bangladesh first, and a shop choosing its currency should not have to scroll
 * past Afghanistan and Angola to reach its own.
 */
export const COMMON_CURRENCY_CODES: readonly string[] = [
  'BDT', 'USD', 'EUR', 'GBP', 'INR', 'PKR', 'AED', 'SAR', 'MYR', 'SGD', 'CAD', 'AUD',
];

const KNOWN = new Set(CURRENCIES.map((currency) => currency.code));

export function isSupportedCurrency(code: string): boolean {
  return KNOWN.has(code.toUpperCase());
}

export function currencyByCode(code: string): CurrencyOption | undefined {
  const upper = code.toUpperCase();
  return CURRENCIES.find((currency) => currency.code === upper);
}
