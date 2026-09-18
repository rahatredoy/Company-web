/** Messages from the storefront API a shopper can meet: catalogue reads, the contact form, reviews and returns. */
const storefront = {
  // --- catalogue reads -------------------------------------------------------
  'This product does not exist.': 'এই পণ্যটি নেই।',
  'No bundle for this product.': 'এই পণ্যের কোনো বান্ডেল নেই।',
  'This category does not exist.': 'এই ক্যাটাগরিটি নেই।',
  'This brand does not exist.': 'এই ব্র্যান্ডটি নেই।',
  'This page does not exist.': 'এই পেজটি নেই।',

  // --- contact form ----------------------------------------------------------
  'Tell us your name.': 'আপনার নাম লিখুন।',
  'Write your message.': 'আপনার বার্তা লিখুন।',

  // --- reviews ---------------------------------------------------------------
  'Choose a rating.': 'একটি রেটিং বেছে নিন।',
  'Tell us a little more.': 'আরেকটু বিস্তারিত লিখুন।',
  'Sign in to leave a review.': 'রিভিউ দিতে সাইন ইন করুন।',

  // --- orders and returns ----------------------------------------------------
  'Choose what you are returning.': 'কোন পণ্য রিটার্ন করছেন তা বেছে নিন।',
  'Tell us why.': 'কারণটি জানান।',
  'This order cannot be returned.': 'এই অর্ডারটি রিটার্ন করা যাবে না।',
  'That item is not on this order.': 'এই পণ্যটি এই অর্ডারে নেই।',
  'One of the chosen items is not on this order.': 'বেছে নেওয়া পণ্যগুলোর একটি এই অর্ডারে নেই।',

  // --- the order timeline (orders.service.ts) --------------------------------
  'Order placed': 'অর্ডার দেওয়া হয়েছে',
  'Confirmed': 'নিশ্চিত',
  'Processing': 'প্রক্রিয়াধীন',
  'Shipped': 'পাঠানো হয়েছে',
  'Delivered': 'ডেলিভারি হয়েছে',

  // --- selling by weight (lib/measure.ts) ------------------------------------
  'That item is not sold by weight or volume.': 'এই পণ্যটি ওজন বা আয়তনে বিক্রি হয় না।',
  'That size is no longer offered. Please pick another.': 'এই সাইজটি আর পাওয়া যায় না। অন্য একটি বেছে নিন।',

  // --- Google sign-in --------------------------------------------------------
  'Signing in with Google is not available on this store.': 'এই স্টোরে Google দিয়ে সাইন ইন করার সুবিধা নেই।',
  'Google could not confirm that sign-in. Please try again.': 'Google সাইন ইনটি নিশ্চিত করতে পারেনি। আবার চেষ্টা করুন।',
  'Google did not return a sign-in token.': 'Google থেকে সাইন ইন টোকেন পাওয়া যায়নি।',
  'That Google sign-in could not be accepted.': 'এই Google সাইন ইন গ্রহণ করা যায়নি।',
  'That Google sign-in could not be read.': 'এই Google সাইন ইনের তথ্য পড়া যায়নি।',
  'That sign-in link has expired. Please start again from the shop.': 'সাইন ইন লিংকটির মেয়াদ শেষ হয়ে গেছে। স্টোর থেকে আবার শুরু করুন।',
} as const;

export default storefront;
