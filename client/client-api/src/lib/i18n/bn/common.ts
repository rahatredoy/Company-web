/**
 * What the API says before any module gets a word in: the error handler's own
 * messages, the tenant and auth plugins, rate limiting and HTTPS.
 */
const common = {
  'Some fields need your attention.': 'কিছু ঘর ঠিক করতে হবে।',
  'Something went wrong. Please try again.': 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
  'Too many requests. Please try again later.': 'অনেক বেশি অনুরোধ হয়েছে। একটু পরে আবার চেষ্টা করুন।',
  'Invalid request.': 'অনুরোধটি সঠিক নয়।',
  'The requested endpoint does not exist.': 'অনুরোধ করা ঠিকানাটি নেই।',
  'That value is already in use.': 'এই মানটি আগে থেকেই ব্যবহৃত হচ্ছে।',
  'A referenced record does not exist.': 'সংশ্লিষ্ট রেকর্ডটি পাওয়া যায়নি।',
  'That value is not allowed.': 'এই মানটি গ্রহণযোগ্য নয়।',
  'Malformed identifier.': 'শনাক্তকারীটি সঠিক নয়।',
  'Invalid identifier.': 'শনাক্তকারীটি সঠিক নয়।',
  'Choose a language from the list.': 'তালিকা থেকে একটি ভাষা বেছে নিন।',

  // --- the default messages of lib/errors.ts ----------------------------------
  'Sign in to continue.': 'চালিয়ে যেতে সাইন ইন করুন।',
  'You do not have access to this resource.': 'এটি দেখার অনুমতি আপনার নেই।',
  'Resource not found.': 'খুঁজে পাওয়া যায়নি।',
  'Resource already exists.': 'এটি আগে থেকেই আছে।',
  'That order does not exist.': 'এই অর্ডারটি পাওয়া যায়নি।',

  // --- security, HTTPS and the store behind the hostname ----------------------
  'Origin not allowed.': 'এই উৎস থেকে অনুরোধ গ্রহণ করা হয় না।',
  'Request origin is not allowed.': 'অনুরোধের উৎসটি অনুমোদিত নয়।',
  'This API is served over HTTPS only. Retry over https:// with fresh credentials.': 'এই API শুধু HTTPS-এ চলে। নতুন লগইন তথ্য দিয়ে https:// ব্যবহার করে আবার চেষ্টা করুন।',
  'This address is not connected to a store.': 'এই ঠিকানাটি কোনো স্টোরের সঙ্গে যুক্ত নয়।',
  'This store is not available.': 'এই স্টোরটি এখন পাওয়া যাচ্ছে না।',
  'No store context for this request.': 'এই অনুরোধের জন্য কোনো স্টোর পাওয়া যায়নি।',
  'This store is suspended. Contact platform support to restore access.': 'এই স্টোরটি স্থগিত করা হয়েছে। আবার চালু করতে প্ল্যাটফর্ম সাপোর্টে যোগাযোগ করুন।',
  'Your trial or subscription has ended. Renew it from your account area to continue.': 'আপনার ট্রায়াল বা সাবস্ক্রিপশনের মেয়াদ শেষ হয়েছে। চালিয়ে যেতে আপনার অ্যাকাউন্ট থেকে নবায়ন করুন।',
  'This store’s subscription was cancelled.': 'এই স্টোরের সাবস্ক্রিপশন বাতিল করা হয়েছে।',
  'Your store is still being created. This usually takes under a minute.': 'আপনার স্টোর এখনো তৈরি হচ্ছে। সাধারণত এক মিনিটের কম সময় লাগে।',
  'Your store is not ready yet.': 'আপনার স্টোর এখনো প্রস্তুত হয়নি।',

  // --- lib/validation.ts and lib/secure-url.ts ---------------------------------
  'Enter a valid email address.': 'একটি সঠিক ইমেইল ঠিকানা দিন।',
  'Use at least 10 characters.': 'অন্তত ১০টি অক্ষর ব্যবহার করুন।',
  'That password is too long.': 'পাসওয়ার্ডটি অনেক লম্বা।',
  'Include a lowercase letter.': 'অন্তত একটি ছোট হাতের অক্ষর দিন।',
  'Include an uppercase letter.': 'অন্তত একটি বড় হাতের অক্ষর দিন।',
  'Include a number.': 'অন্তত একটি সংখ্যা দিন।',
  'That link is not valid.': 'লিংকটি সঠিক নয়।',
  'Enter a name.': 'একটি নাম দিন।',
  'Enter a valid phone number.': 'একটি সঠিক ফোন নম্বর দিন।',
  'Use lowercase letters, numbers and single hyphens.': 'ছোট হাতের অক্ষর, সংখ্যা ও একক হাইফেন ব্যবহার করুন।',
  'Use single hyphens only.': 'শুধু একক হাইফেন ব্যবহার করুন।',
  'Enter an amount like 19.99.': 'অর্থের পরিমাণ 19.99-এর মতো করে লিখুন।',
  'Amount cannot be negative.': 'অর্থের পরিমাণ ঋণাত্মক হতে পারে না।',
  'Use a full https:// web address.': 'https:// দিয়ে শুরু হওয়া পূর্ণ ওয়েব ঠিকানা দিন।',
  'Use an https:// address or a path beginning with /.': 'https:// ঠিকানা অথবা / দিয়ে শুরু হওয়া একটি পাথ দিন।',
} as const;

export default common;
