import type { Messages } from '../index';

/** The chrome every page shares: the six templates' headers and footers, navigation, search, the category menu, locale selects, the store gate, error and not-found pages, and the UI primitives. */
const layout = {
  // --- header and navigation -------------------------------------------------
  'Main': 'প্রধান',
  'Mobile': 'মোবাইল',
  'Quick navigation': 'দ্রুত নেভিগেশন',
  'All Categories': 'সব ক্যাটাগরি',
  'All {name}': 'সব {name}',
  'View all categories': 'সব ক্যাটাগরি দেখুন',
  'Collapse {name}': '{name} বন্ধ করুন',
  'Expand {name}': '{name} খুলুন',
  'Browse categories and shop links for {store}.': '{store}-এর ক্যাটাগরি ও শপের লিংকগুলো দেখুন।',
  'New': 'নতুন',
  'Hot': 'হট',
  'Your account': 'আপনার অ্যাকাউন্ট',
  'Wishlist, {count} items': 'উইশলিস্ট, {count}টি পণ্য',
  'Cart, {count} items': 'কার্ট, {count}টি পণ্য',
  'Back to top': 'উপরে ফিরে যান',
  'Previous announcement': 'আগের ঘোষণা',
  'Next announcement': 'পরের ঘোষণা',
  'Call us: {phone}': 'কল করুন: {phone}',

  // --- search ----------------------------------------------------------------
  'Search for products…': 'পণ্য খুঁজুন…',
  'Search by model, brand or spec…': 'মডেল, ব্র্যান্ড বা স্পেসিফিকেশন দিয়ে খুঁজুন…',
  'Clear search': 'খোঁজা মুছুন',
  'Search suggestions': 'খোঁজার পরামর্শ',
  'See all results for “{term}”': '“{term}”-এর সব ফলাফল দেখুন',
  'Br::brand': 'ব্র্যা',
  'Cat::category': 'ক্যা',

  // --- footer ----------------------------------------------------------------
  'Company': 'কোম্পানি',
  'We Accept': 'আমরা গ্রহণ করি',
  '© {year} {store}. All rights reserved.': '© {year} {store}। সর্বস্বত্ব সংরক্ষিত।',
  'Chat with us on WhatsApp': 'WhatsApp-এ আমাদের সাথে চ্যাট করুন',
  'Hello! I have a question about a product.': 'হ্যালো! একটি পণ্য সম্পর্কে আমার একটি প্রশ্ন আছে।',

  // --- a store that is not trading -------------------------------------------
  'This store is being set up and will open shortly. Please check back soon.': 'স্টোরটি প্রস্তুত করা হচ্ছে, শিগগিরই চালু হবে। একটু পরে আবার দেখুন।',
  'This store is temporarily unavailable.': 'স্টোরটি সাময়িকভাবে বন্ধ আছে।',
  'Need to reach us?': 'আমাদের সাথে যোগাযোগ করতে চান?',

  // --- errors and not found --------------------------------------------------
  'Error 404': 'ত্রুটি ৪০৪',
  'The page you are looking for does not exist, or it may have moved.': 'আপনি যে পেজটি খুঁজছেন সেটি নেই, অথবা সরিয়ে নেওয়া হয়েছে।',
  'Go home': 'হোমে যান',
  'Shop products': 'পণ্য দেখুন',
  'Something went wrong': 'কিছু একটা সমস্যা হয়েছে',
  'We could not load this page. Please try again — if it keeps happening, contact us and we will look into it.': 'পেজটি লোড করা যায়নি। আবার চেষ্টা করুন — সমস্যাটি চলতে থাকলে আমাদের জানান, আমরা বিষয়টি দেখব।',
  'This store could not be loaded. Please refresh the page and try again.': 'স্টোরটি লোড করা যায়নি। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।',
  'Reference {code}': 'রেফারেন্স {code}',

  // --- design switcher -------------------------------------------------------
  'Change the store design': 'স্টোরের ডিজাইন পরিবর্তন করুন',
  'Store design': 'স্টোরের ডিজাইন',
  'Try any layout and colour. Only you see the change.': 'যেকোনো লেআউট ও রং চেষ্টা করে দেখুন। পরিবর্তনটি শুধু আপনিই দেখবেন।',
  'You are previewing': 'আপনি প্রিভিউ দেখছেন',
  'Visitors still see {design}.': 'ভিজিটররা এখনো {design} দেখছেন।',
  'Layout': 'লেআউট',
  'Colour': 'রং',
  'Reset': 'রিসেট করুন',
  'Dense, search-led layout for large multi-category catalogues.': 'অনেক ক্যাটাগরির বড় ক্যাটালগের জন্য ঘন, খোঁজা-কেন্দ্রিক লেআউট।',
  'Clean, balanced and conversion-focused. The default.': 'পরিচ্ছন্ন, ভারসাম্যপূর্ণ ও বিক্রিমুখী। ডিফল্ট ডিজাইন।',
  'Editorial photography and elegant type, built for apparel.': 'পোশাকের জন্য তৈরি — ম্যাগাজিন-ধাঁচের ছবি ও রুচিশীল লেখা।',
  'Restrained and premium, for small curated catalogues.': 'ছোট, বাছাই করা ক্যাটালগের জন্য সংযত ও প্রিমিয়াম।',
  'Spec-forward cards, deals and comparison for tech.': 'প্রযুক্তি পণ্যের জন্য স্পেসিফিকেশন-প্রধান কার্ড, অফার ও তুলনা।',
  'Warm editorial layout for home, decor and lifestyle goods.': 'ঘর, সাজসজ্জা ও লাইফস্টাইল পণ্যের জন্য উষ্ণ, ম্যাগাজিন-ধাঁচের লেআউট।',

  // --- UI primitives ---------------------------------------------------------
  '{count} items, scrollable': '{count}টি আইটেম, স্ক্রল করা যায়',
  '(required)': '(আবশ্যক)',
  'Loading products…': 'পণ্য লোড হচ্ছে…',
  'Decrease {label}': '{label} কমান',
  'Increase {label}': '{label} বাড়ান',

  // --- status badges (orders, payments, returns, refunds) --------------------
  'Confirmed': 'নিশ্চিত',
  'Packed': 'প্যাক করা হয়েছে',
  'Out for delivery': 'ডেলিভারির পথে',
  'Not shipped': 'এখনো পাঠানো হয়নি',
  'Returned': 'রিটার্ন হয়েছে',
  'Refunded': 'রিফান্ড হয়েছে',
  'Failed': 'ব্যর্থ',
  'Paid': 'পরিশোধিত',
  'Partially paid': 'আংশিক পরিশোধিত',
  'Partially refunded': 'আংশিক রিফান্ড হয়েছে',
  'Cod pending': 'ক্যাশ অন ডেলিভারি বাকি',
  'Requested': 'অনুরোধ করা হয়েছে',
  'Under review': 'পর্যালোচনাধীন',
  'Approved': 'অনুমোদিত',
  'Rejected': 'প্রত্যাখ্যাত',
  'Received': 'পণ্য পাওয়া গেছে',
  'Product received': 'পণ্য পাওয়া গেছে',
  'Inspected': 'যাচাই করা হয়েছে',
  'Inspection': 'যাচাই চলছে',
  'Completed': 'সম্পন্ন',
  'Refund': 'রিফান্ড',
  'Exchange': 'বদল',
  'Replacement': 'প্রতিস্থাপন',
} satisfies Messages;

export default layout;
