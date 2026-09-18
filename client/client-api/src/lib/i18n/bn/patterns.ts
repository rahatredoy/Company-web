/**
 * Messages with values inside them, which no exact key can match.
 *
 * Mostly Zod's own defaults — what a field says when its schema gave no message
 * of its own — whose English shapes are fixed by `zod/v4/locales/en`. Zod ships
 * no Bangla locale, and its locale switch is process-wide, which one API serving
 * stores in two languages cannot use. So they are recognised here instead.
 *
 * A pattern must match the **whole** message (`^…$`), or a sentence that merely
 * contains one would be half replaced.
 */
export type MessagePattern = readonly [RegExp, (match: RegExpExecArray) => string];

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/** `>=12` → `১২`: a value caught from English, in Bangla digits. */
export function digits(value: string | undefined): string {
  return (value ?? '').replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)]!);
}

const SIZE_UNIT: Record<string, string> = {
  characters: 'অক্ষর',
  items: 'টি',
  bytes: 'বাইট',
  elements: 'টি',
};

export const BN_PATTERNS: readonly MessagePattern[] = [
  // --- required and wrong type ----------------------------------------------
  [/^Invalid input: expected \w+, received (?:undefined|null)$/, () => 'এই ঘরটি পূরণ করুন।'],
  [/^Invalid input: expected (?:number|int|bigint), received \w+$/, () => 'একটি সংখ্যা দিন।'],
  [/^Invalid input: expected boolean, received \w+$/, () => 'হ্যাঁ বা না বেছে নিন।'],
  [/^Invalid input: expected date, received \w+$/, () => 'একটি সঠিক তারিখ দিন।'],
  [/^Invalid input: expected array, received \w+$/, () => 'একটি তালিকা দিন।'],
  [/^Invalid input: expected \w+, received \w+$/, () => 'এই মানটি সঠিক ধরনের নয়।'],
  [/^Invalid input: expected .+$/, () => 'এই মানটি গ্রহণযোগ্য নয়।'],
  [/^Invalid option: expected one of .+$/, () => 'তালিকা থেকে একটি বেছে নিন।'],
  [/^Invalid input$/, () => 'এই মানটি গ্রহণযোগ্য নয়।'],

  // --- length and size -------------------------------------------------------
  [
    /^Too small: expected string to have >=?(\d+) characters$/,
    (m) => (m[1] === '1' ? 'এই ঘরটি পূরণ করুন।' : `অন্তত ${digits(m[1])}টি অক্ষর দিন।`),
  ],
  [/^Too big: expected string to have <=?(\d+) characters$/, (m) => `সর্বোচ্চ ${digits(m[1])}টি অক্ষর দেওয়া যাবে।`],
  [/^Too small: expected array to have >=?(\d+) items$/, (m) => `অন্তত ${digits(m[1])}টি দিন।`],
  [/^Too big: expected array to have <=?(\d+) items$/, (m) => `সর্বোচ্চ ${digits(m[1])}টি দেওয়া যাবে।`],
  [/^Too small: expected number to be >(-?[\d.]+)$/, (m) => `${digits(m[1])}-এর বেশি হতে হবে।`],
  [/^Too small: expected number to be >=(-?[\d.]+)$/, (m) => `অন্তত ${digits(m[1])} হতে হবে।`],
  [/^Too big: expected number to be <(-?[\d.]+)$/, (m) => `${digits(m[1])}-এর কম হতে হবে।`],
  [/^Too big: expected number to be <=(-?[\d.]+)$/, (m) => `সর্বোচ্চ ${digits(m[1])} হতে পারে।`],
  [
    /^Too (small|big): expected \w+ to have [<>]=?(\d+) (\w+)$/,
    (m) => `${m[1] === 'small' ? 'অন্তত' : 'সর্বোচ্চ'} ${digits(m[2])} ${SIZE_UNIT[m[3]!] ?? ''}`.trim() + '।',
  ],

  // --- formats ---------------------------------------------------------------
  [/^Invalid email address$/, () => 'একটি সঠিক ইমেইল ঠিকানা দিন।'],
  [/^Invalid URL$/, () => 'একটি সঠিক লিংক দিন।'],
  [/^Invalid UUID$/, () => 'শনাক্তকারীটি সঠিক নয়।'],
  [/^Invalid ISO datetime$/, () => 'একটি সঠিক তারিখ ও সময় দিন।'],
  [/^Invalid ISO date$/, () => 'একটি সঠিক তারিখ দিন।'],
  [/^Invalid string: must match pattern .+$/, () => 'এই মানটি সঠিক আকারে নয়।'],
  [/^Invalid string: must (?:start with|end with|include) .+$/, () => 'এই মানটি সঠিক আকারে নয়।'],
  [/^Invalid number: must be a multiple of ([\d.]+)$/, (m) => `${digits(m[1])}-এর গুণিতক হতে হবে।`],
  [/^Invalid \w+$/, () => 'এই মানটি সঠিক আকারে নয়।'],
  [/^Unrecognized keys?: .+$/, () => 'অনুরোধে অপ্রত্যাশিত ঘর আছে।'],

  // --- this API's own messages with a value in them ---------------------------
  // lib/rate-limit.ts
  [
    /^Too many attempts\. Try again in (\d+) seconds\.$/,
    (m) => `অনেকবার চেষ্টা করা হয়েছে। ${digits(m[1])} সেকেন্ড পর আবার চেষ্টা করুন।`,
  ],
  // modules/settings — a currency switch on a store that has taken orders
  [
    /^This store has taken orders in (\S+)\. Switching to (\S+) does not convert prices — every price keeps its number and changes its symbol — so it has to be confirmed\.$/,
    (m) =>
      `এই স্টোরে ${m[1]} মুদ্রায় অর্ডার নেওয়া হয়েছে। ${m[2]}-এ বদলালে দাম রূপান্তর হয় না — প্রতিটি দামের সংখ্যা একই থাকে, শুধু চিহ্ন বদলায় — তাই এটি নিশ্চিত করতে হবে।`,
  ],
  // modules/catalog — deleting a category that still has children
  [
    /^Move or delete the (\d+) subcategor(?:y|ies) inside this one first\.$/,
    (m) => `আগে এর ভেতরের ${digits(m[1])}টি সাবক্যাটাগরি সরিয়ে নিন বা মুছে ফেলুন।`,
  ],
  // modules/uploads
  [/^That file is larger than (\d+)MB\.$/, (m) => `ফাইলটি ${digits(m[1])}MB-এর চেয়ে বড়।`],
  // modules/inventory — deleting a warehouse that still holds stock
  [
    /^That warehouse still holds (\d+) unit\(s\)\. Move or write them off first\.$/,
    (m) => `এই গুদামে এখনো ${digits(m[1])}টি ইউনিট আছে। আগে সেগুলো সরিয়ে নিন বা বাদ দিন।`,
  ],
  // modules/fulfilment — a status change the return or refund graph refuses
  [
    /^A refund that is ([a-z_ ]+) cannot become ([a-z_ ]+)\.$/,
    (m) => `রিফান্ডের স্ট্যাটাস "${statusWord(m[1])}" থেকে "${statusWord(m[2])}" করা যায় না।`,
  ],
  [
    /^A return that is ([a-z_ ]+) cannot become ([a-z_ ]+)\.$/,
    (m) => `রিটার্নের স্ট্যাটাস "${statusWord(m[1])}" থেকে "${statusWord(m[2])}" করা যায় না।`,
  ],
  // modules/storefront/returns.routes.ts — more than is left on the line
  [
    /^You can return at most (\d+) of (.+)\.$/,
    (m) => `${m[2]} থেকে সর্বোচ্চ ${digits(m[1])}টি রিটার্ন করতে পারবেন।`,
  ],
  [/^Only (\d+) of (.+) can be returned\.$/, (m) => `${m[2]} থেকে শুধু ${digits(m[1])}টি রিটার্ন করা যাবে।`],
  // lib/measure.ts — a line below a product's minimum weight or volume
  [/^The smallest order for this item is (.+)\.$/, (m) => `এই পণ্যের সর্বনিম্ন অর্ডার ${digits(m[1])}।`],
];

/** A return or refund status as the panel names it. */
const STATUS_WORD: Record<string, string> = {
  requested: 'অনুরোধ করা হয়েছে',
  'under review': 'পর্যালোচনাধীন',
  approved: 'অনুমোদিত',
  rejected: 'প্রত্যাখ্যাত',
  received: 'ফেরত পাওয়া গেছে',
  inspected: 'যাচাই করা হয়েছে',
  processing: 'প্রক্রিয়াধীন',
  completed: 'সম্পন্ন',
  failed: 'ব্যর্থ',
};

function statusWord(value: string | undefined): string {
  const key = (value ?? '').replace(/_/g, ' ');
  return STATUS_WORD[key] ?? key;
}

