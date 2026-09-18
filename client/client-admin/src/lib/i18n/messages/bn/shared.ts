import type { Messages } from '../index';

/** Shared building blocks every screen uses: the detail sheet, the scrolling table, filters, image upload, status badges, dialogs and sheets. */
const shared = {
  // --- detail sheet ----------------------------------------------------------
  'That record could not be loaded': 'রেকর্ডটি লোড করা যায়নি',
  'That record could not be loaded.': 'রেকর্ডটি লোড করা যায়নি।',
  'Copy identifier': 'আইডি কপি করুন',
  'Nothing yet.': 'এখনো কিছু নেই।',
  'Empty': 'খালি',
  'View in store': 'স্টোরে দেখুন',

  // --- scrolling lists: the footer tally ------------------------------------
  'No {noun}s to show': 'দেখানোর মতো কোনো {noun} নেই',
  'Showing {shown} of {total} {noun}': 'মোট {total}টি {noun} থেকে {shown}টি দেখানো হচ্ছে',
  'Showing {shown} of {total} {noun}s': 'মোট {total}টি {noun} থেকে {shown}টি দেখানো হচ্ছে',
  '{count} {noun}': '{count}টি {noun}',
  '{count} {noun}s': '{count}টি {noun}',
  'End of list': 'তালিকার শেষ',
  'Could not load more rows.': 'আরও সারি লোড করা যায়নি।',

  // --- scrolling lists: the nouns a list counts in (`noun=` on InfiniteTable) --
  'row': 'সারি',
  'item': 'আইটেম',
  'brand': 'ব্র্যান্ড',
  'category': 'ক্যাটাগরি',
  'code': 'কোড',
  'customer': 'গ্রাহক',
  'message': 'বার্তা',
  'order': 'অর্ডার',
  'page': 'পেজ',
  'product': 'পণ্য',
  'refund': 'রিফান্ড',
  'return': 'রিটার্ন',
  'review': 'রিভিউ',

  // --- filters ---------------------------------------------------------------
  'Clear search': 'খোঁজ মুছুন',

  // --- image upload ----------------------------------------------------------
  'Upload an image': 'ছবি আপলোড করুন',
  'That file could not be uploaded.': 'ফাইলটি আপলোড করা যায়নি।',
  'That address does not load as an image.': 'এই ঠিকানা থেকে কোনো ছবি লোড হচ্ছে না।',
  'or paste an address': 'অথবা একটি ঠিকানা পেস্ট করুন',

  // --- page header, toasts, request failures --------------------------------
  'Breadcrumb': 'নেভিগেশন পথ',
  'Notifications': 'নোটিফিকেশন',
  'Close toast': 'নোটিফিকেশন বন্ধ করুন',
  'Request failed.': 'অনুরোধ ব্যর্থ হয়েছে।',
  'Cannot reach the server. Check your connection and try again.': 'সার্ভারে পৌঁছানো যাচ্ছে না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',

  // --- status badges: the named labels --------------------------------------
  'Unverified': 'যাচাই হয়নি',
  'In Progress': 'চলমান',
  'Not Created': 'তৈরি হয়নি',
  'Platform Subdomain': 'প্ল্যাটফর্ম সাবডোমেইন',
  'Admin': 'অ্যাডমিন',
  'Out for Delivery': 'ডেলিভারির পথে',
  'Part Paid': 'আংশিক পরিশোধিত',
  'Part Refunded': 'আংশিক রিফান্ড',
  'Not Shipped': 'পাঠানো হয়নি',
  'High Value': 'মূল্যবান গ্রাহক',
  'Open::status': 'খোলা',
  'Repeat::customer': 'নিয়মিত গ্রাহক',

  // --- status badges: every other status, title-cased as the fallback shows it --
  'Ready': 'প্রস্তুত',
  'Verified': 'যাচাইকৃত',
  'Converted': 'রূপান্তরিত',
  'Resolved': 'সমাধান হয়েছে',
  'Provisioning': 'প্রস্তুত হচ্ছে',
  'Creating': 'তৈরি হচ্ছে',
  'Verifying': 'যাচাই হচ্ছে',
  'Closed': 'বন্ধ',
  'Void': 'বাতিলকৃত',
  'Issued': 'ইস্যু করা হয়েছে',
  'Queued': 'সারিতে আছে',
  'Authorized': 'অথরাইজড',
  'Blocked': 'ব্লক করা',
  'New Customer': 'নতুন গ্রাহক',
  'Vip': 'ভিআইপি',
} satisfies Messages;

export default shared;
